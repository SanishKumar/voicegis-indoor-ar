/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useDialogFocus } from './useDialogFocus';

/**
 * Both dialogs declared `aria-modal="true"` and did nothing about focus.
 * Opening one left focus on the opener, so a keyboard user tabbed straight past
 * the dialog into the page behind it; closing one dropped focus on `<body>`, so
 * the next Tab restarted at the top of the document.
 *
 * jsdom implements focus and Tab key events but not Tab's own focus movement,
 * so these assert what the trap does about a Tab — preventing it and placing
 * focus itself — rather than what a browser would do unaided.
 */

function Dialog({
  onEscape,
  controls = 2,
}: {
  onEscape?: () => void;
  controls?: number;
}) {
  const { containerRef } = useDialogFocus<HTMLDivElement>(true, { onEscape });
  return (
    <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Test dialog" tabIndex={-1}>
      {Array.from({ length: controls }, (_, index) => (
        <button key={index} type="button">
          control {index + 1}
        </button>
      ))}
    </div>
  );
}

function Harness({ controls = 2 }: { controls?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open the dialog
      </button>
      <button type="button">somewhere else</button>
      {open && <Dialog onEscape={() => setOpen(false)} controls={controls} />}
    </>
  );
}

afterEach(cleanup);

describe('focus containment', () => {
  it('moves focus into the dialog when it opens', () => {
    render(<Harness />);
    screen.getByText('open the dialog').focus();

    fireEvent.click(screen.getByText('open the dialog'));

    expect(document.activeElement).toBe(screen.getByText('control 1'));
  });

  it('wraps forwards from the last control to the first', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open the dialog'));
    screen.getByText('control 2').focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByText('control 1'));
  });

  it('wraps backwards from the first control to the last', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open the dialog'));
    screen.getByText('control 1').focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(screen.getByText('control 2'));
  });

  it('pulls focus back when it has escaped the dialog entirely', () => {
    // The case aria-modal actually promises: the page behind is unreachable.
    render(<Harness />);
    fireEvent.click(screen.getByText('open the dialog'));
    screen.getByText('somewhere else').focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByText('control 1'));
  });

  it('holds focus on the dialog when it contains nothing focusable yet', () => {
    // A scanner still opening its camera has no controls for a moment.
    render(<Harness controls={0} />);
    fireEvent.click(screen.getByText('open the dialog'));

    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });

  it('leaves other keys alone', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open the dialog'));
    screen.getByText('control 2').focus();

    fireEvent.keyDown(document, { key: 'a' });

    expect(document.activeElement).toBe(screen.getByText('control 2'));
  });
});

describe('nested dialogs', () => {
  /** A dialog inside a dialog, which is the scanner inside the location picker. */
  function Nested() {
    const [outer, setOuter] = useState(false);
    const [inner, setInner] = useState(false);
    const { containerRef: outerRef } = useDialogFocus<HTMLDivElement>(outer, {
      onEscape: () => setOuter(false),
    });
    const { containerRef: innerRef } = useDialogFocus<HTMLDivElement>(inner, {
      onEscape: () => setInner(false),
    });
    return (
      <>
        <button type="button" onClick={() => setOuter(true)}>
          open outer
        </button>
        {outer && (
          <div
            ref={outerRef}
            role="dialog"
            aria-modal="true"
            aria-label="outer"
            tabIndex={-1}
          >
            <button type="button" onClick={() => setInner(true)}>
              open inner
            </button>
            {inner && (
              <div
                ref={innerRef}
                role="dialog"
                aria-modal="true"
                aria-label="inner"
                tabIndex={-1}
              >
                <button type="button">inner control</button>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  it('closes only the topmost dialog on Escape', () => {
    // Each mounted dialog installs its own document-level Escape listener, so
    // one keypress ran both close handlers: dismissing the scanner also threw
    // away the picker that opened it.
    render(<Nested />);
    fireEvent.click(screen.getByText('open outer'));
    fireEvent.click(screen.getByText('open inner'));
    expect(screen.getByLabelText('inner')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByLabelText('inner')).toBeNull();
    expect(screen.queryByLabelText('outer'), 'the outer dialog closed too').not.toBeNull();
  });

  it('closes the one underneath on a second Escape', () => {
    render(<Nested />);
    fireEvent.click(screen.getByText('open outer'));
    fireEvent.click(screen.getByText('open inner'));

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByLabelText('outer')).toBeNull();
  });

  it('contains Tab in the topmost dialog only', () => {
    render(<Nested />);
    fireEvent.click(screen.getByText('open outer'));
    fireEvent.click(screen.getByText('open inner'));

    screen.getByText('inner control').focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // The outer trap must not drag focus back to its own first control.
    expect(document.activeElement).toBe(screen.getByText('inner control'));
  });
});

describe('focus restoration', () => {
  it('returns focus to the opener even when the dialog autofocuses a control', () => {
    // The real defect: React applies autoFocus during commit, before effects
    // run, so reading document.activeElement on open captured a control inside
    // the dialog. Restoring to it did nothing once the dialog unmounted, and
    // focus fell to <body>.
    function AutoFocusing() {
      const [open, setOpen] = useState(false);
      const { containerRef } = useDialogFocus<HTMLDivElement>(open, {
        onEscape: () => setOpen(false),
      });
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open the dialog
          </button>
          {open && (
            <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Auto" tabIndex={-1}>
              <input autoFocus aria-label="search" />
              <button type="button">control</button>
            </div>
          )}
        </>
      );
    }

    render(<AutoFocusing />);
    const opener = screen.getByText('open the dialog');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.activeElement).toBe(opener);
  });

  it('gives focus back to whatever opened the dialog', () => {
    render(<Harness />);
    const opener = screen.getByText('open the dialog');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).not.toBe(opener);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.activeElement).toBe(opener);
  });

  it('does not throw when the opener has left the document', () => {
    // A dialog that replaces the control which opened it, which the location
    // picker does when it changes the start point.
    function Vanishing() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {!open && (
            <button type="button" onClick={() => setOpen(true)}>
              open and disappear
            </button>
          )}
          {open && <Dialog onEscape={() => setOpen(false)} />}
        </>
      );
    }

    render(<Vanishing />);
    fireEvent.click(screen.getByText('open and disappear'));

    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
  });

  it('calls the escape handler rather than closing anything itself', () => {
    const onEscape = vi.fn();
    render(<Dialog onEscape={onEscape} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
