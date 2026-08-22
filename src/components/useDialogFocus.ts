import { useCallback, useEffect, useRef } from 'react';

/**
 * Keeps keyboard focus inside a dialog, and gives it back afterwards.
 *
 * Both dialogs here declared `role="dialog"` and `aria-modal="true"` and
 * neither did anything about focus. Opening one left focus on the button that
 * opened it, so a screen-reader user was told a dialog had appeared and then
 * tabbed straight past it into the page behind; closing one dropped focus onto
 * `<body>`, which starts the next Tab back at the top of the document.
 *
 * `aria-modal` is a promise to assistive technology that the rest of the page
 * is unreachable. Nothing enforces it, so making the promise without trapping
 * focus is worse than not making it: it tells the user something untrue.
 *
 * Deliberately a hook rather than a wrapper component, so a dialog keeps its own
 * markup and this cannot start owning layout as well.
 *
 * Restoration is covered by unit tests rather than by driving a browser here,
 * because a window without focus is a poor witness: `document.hasFocus()` is
 * false in a hidden pane, and `focus()` then moves `document.activeElement`
 * without dispatching a single `focusin`, so the history below never fills and
 * restoration appears broken when it is not. Re-verify it in the browser smoke
 * suite, where the page genuinely holds focus.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Whether an element can actually take focus.
 *
 * Asked semantically rather than by measuring boxes. A first attempt used
 * `offsetWidth`/`getClientRects`, which is wrong twice: a zero-sized control is
 * still focusable, and jsdom reports zero for everything, so every control in
 * every dialog looked unfocusable and the trap silently degraded to holding
 * focus on the container.
 */
function canTakeFocus(element: HTMLElement): boolean {
  if (element.hasAttribute('inert') || element.closest('[inert]') !== null) return false;

  // The accurate answer where the platform offers one.
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ checkVisibilityCSS: true });
  }

  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(canTakeFocus);
}

export interface DialogFocusOptions {
  /** Called on Escape. Omit if the dialog should not close that way. */
  onEscape?: () => void;
}

/**
 * Returns the ref to put on the dialog element.
 *
 * The element should also carry `tabIndex={-1}`, so focus has somewhere to go
 * when the dialog contains no controls yet — a scanner still opening its camera,
 * for instance.
 */
export function useDialogFocus<T extends HTMLElement>(
  active: boolean,
  { onEscape }: DialogFocusOptions = {},
) {
  const containerRef = useRef<T | null>(null);
  /**
   * Recent focus, most recent last, used to find what to restore to.
   *
   * A history rather than a single value, because the dialog can take focus
   * before anything here can stop it. React applies `autoFocus` during commit -
   * before effects run and before refs are attached - so both
   * `document.activeElement` on open and a containment check against the
   * container are too late: each recorded the dialog's own input as the thing
   * to return to, and restoring to it did nothing once the dialog unmounted,
   * dropping focus onto <body>. Choosing from a history on activation depends
   * on no commit ordering at all.
   */
  const focusHistoryRef = useRef<HTMLElement[]>([]);
  // Held in a ref so the effect does not restart when the caller passes a new
  // closure each render, which would re-run the whole trap on every keystroke.
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (active) return undefined;
    const remember = () => {
      const element = document.activeElement as HTMLElement | null;
      if (element === null || element === document.body) return;
      const history = focusHistoryRef.current;
      if (history[history.length - 1] === element) return;
      history.push(element);
      // Only the tail matters; anything older is a stale opener at best.
      if (history.length > 8) history.shift();
    };
    remember();
    document.addEventListener('focusin', remember, true);
    return () => document.removeEventListener('focusin', remember, true);
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || container === null) return undefined;

    // The most recent focus that was not inside this dialog and is still in the
    // page. Walked backwards so an autoFocus that already fired is skipped over
    // rather than mistaken for the opener.
    const live = document.activeElement as HTMLElement | null;
    // The live element is the most recent candidate of all, and covers a dialog
    // that mounts already open - its history is empty, because the effect that
    // fills it only runs while the dialog is closed.
    const candidates = [
      ...focusHistoryRef.current,
      ...(live !== null && live !== document.body ? [live] : []),
    ];

    let returnTo: HTMLElement | null = null;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!candidate.isConnected || container.contains(candidate)) continue;
      returnTo = candidate;
      break;
    }

    const initial = focusableWithin(container)[0] ?? container;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        // Nothing to move between; keep focus on the dialog rather than letting
        // it escape into the page the dialog claims to have covered.
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      // Wrapping is handled explicitly at both ends. Focus starting outside the
      // dialog entirely — which happens when the page moves it — is pulled back
      // rather than left where it is.
      if (!container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Only if it is still in the document and still focusable; a dialog that
      // replaced its own opener would otherwise throw or focus a detached node.
      if (returnTo !== null && returnTo.isConnected && typeof returnTo.focus === 'function') {
        returnTo.focus();
      }
    };
  }, [active]);

  /** Exposed for tests and for callers that need to re-assert containment. */
  const focusFirst = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    (focusableWithin(container)[0] ?? container).focus();
  }, []);

  return { containerRef, focusFirst };
}
