import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/**
 * Layout invariants the surface navigation and the surfaces depend on.
 *
 * Two defects sit behind this file, and they are opposites.
 *
 * The nav was a fixed, centred overlay at z-index 1200, and at 1280x800 it
 * covered the visitor header's controls: `elementFromPoint` at the centre of
 * "Change start location" returned the nav, so the button could not be clicked.
 * Three media queries had accumulated trying to dodge that and disagreed with
 * one another, because a fixed overlay sharing a band with a header collides
 * with something eventually.
 *
 * Moving a top bar into the layout created the reverse problem on narrow Studio
 * surface, which stacks into one column and outgrows the viewport: the
 * *document* became the scroll container and carried the nav away with it, so
 * 700px down the nav sat at y=-692 and no other surface was reachable. A
 * surface that outgrows the viewport has to scroll itself. The current shell
 * makes that ownership explicit: a side rail on a desk, a bottom dock on a
 * phone, and a workspace that owns the remaining rectangle.
 *
 * Parsed with PostCSS rather than by hand. A brace scanner written for this
 * found 1,130 of the sheet's 1,142 rules, and the twelve it lost were enough to
 * hide a comment-prefixed media query containing
 * `.surface-nav:hover { position: fixed }` — which passed every assertion here.
 * A parser that silently skips input is worse than no test, because it reports
 * the same green either way.
 *
 * This remains a stylesheet contract, not a layout test: jsdom performs no
 * layout, so nothing here can prove two boxes do not overlap or that a scroll
 * stays put. It proves the declarations that made both failures possible are
 * gone, and that the ones preventing them are present. The geometry belongs in
 * the browser smoke suite.
 */

const root = postcss.parse(readFileSync('src/index.css', 'utf8'));

interface Declaration {
  prop: string;
  value: string;
}

interface StyleRule {
  selector: string;
  /** The `@media` params this rule sits under, or null at the top level. */
  media: string | null;
  declarations: Declaration[];
}

/** Rules whose selector targets the class itself, however it is qualified. */
function rulesFor(className: string): StyleRule[] {
  // The class as the final compound's own class, allowing further classes,
  // pseudo-classes and attribute selectors after it, but never a descendant.
  const target = new RegExp(`\\.${className}(?![\\w-])(?:[.:#\\[][^\\s>+~]*)*$`);
  const found: StyleRule[] = [];

  root.walkRules((rule) => {
    if (!rule.selectors.some((selector) => target.test(selector))) return;
    const parent = rule.parent;
    found.push({
      selector: rule.selector,
      media:
        parent !== undefined && parent.type === 'atrule' && parent.name === 'media'
          ? parent.params
          : null,
      declarations: rule.nodes
        .filter((node): node is postcss.Declaration => node.type === 'decl')
        .map((node) => ({ prop: node.prop, value: node.value })),
    });
  });

  return found;
}

function declares(rule: StyleRule, prop: string): string | undefined {
  return rule.declarations.find((declaration) => declaration.prop === prop)?.value;
}

/** Overflow values under which the element, not the document, does the scrolling. */
const OWNS_ITS_SCROLL = ['auto', 'hidden', 'scroll', 'clip'];

function scrollOwnership(rule: StyleRule): string | undefined {
  return declares(rule, 'overflow-y') ?? declares(rule, 'overflow');
}

const SURFACES = ['visitor-shell', 'inspector-surface', 'studio-surface', 'walk-recorder'];

describe('the stylesheet is parsed completely', () => {
  it('sees the whole sheet, so nothing below can pass by being skipped', () => {
    let count = 0;
    root.walkRules(() => {
      count += 1;
    });
    expect(count).toBeGreaterThan(1_000);
    expect(rulesFor('surface-nav').length).toBeGreaterThan(0);
    expect(rulesFor('operator-shell').length).toBeGreaterThan(0);
    expect(rulesFor('operator-workspace').length).toBeGreaterThan(0);
    for (const surface of SURFACES) {
      expect(rulesFor(surface).length, surface).toBeGreaterThan(0);
    }
  });
});

describe('the surface navigation is part of the page, not on top of it', () => {
  it('is never positioned as an overlay', () => {
    for (const rule of rulesFor('surface-nav')) {
      // Absent is fine; only a declared value can be wrong.
      expect(declares(rule, 'position') ?? 'static', rule.selector).not.toMatch(/fixed|absolute/);
    }
  });

  it('sets no viewport offsets, which is how the competing rules crept in', () => {
    // top/bottom only mean anything for a positioned element, so their presence
    // is the signature of the media queries that used to fight over this.
    for (const rule of rulesFor('surface-nav')) {
      expect(declares(rule, 'top'), rule.selector).toBeUndefined();
      expect(declares(rule, 'bottom'), rule.selector).toBeUndefined();
    }
  });

  it('uses a side rail on a desk and a bottom dock on a phone', () => {
    const shell = rulesFor('operator-shell').find(
      (rule) => rule.media === null && declares(rule, 'display') === 'grid',
    );
    expect(shell, 'operator shell has no desktop grid').toBeDefined();
    expect(declares(shell!, 'grid-template-columns')).toContain('176px');

    const desktopNav = rulesFor('surface-nav').find(
      (rule) => rule.media === null && declares(rule, 'flex-direction') === 'column',
    );
    expect(desktopNav, 'surface nav has no desktop rail').toBeDefined();

    const mobileNav = rulesFor('surface-nav').find(
      (rule) => rule.media !== null && /max-width:\s*720px/.test(rule.media),
    );
    expect(mobileNav, 'surface nav has no mobile dock').toBeDefined();
    expect(declares(mobileNav!, 'grid-row')).toBe('2');
    expect(declares(mobileNav!, 'flex-direction')).toBe('row');
  });
});

describe('each surface fills what the navigation leaves and scrolls itself', () => {
  it('does not ask for a whole viewport on top of the nav row', () => {
    // `height: 100%` and `min-height: 100vh` were right while the nav took no
    // space. With a nav row above them they overshoot by exactly its height.
    for (const surface of SURFACES) {
      const rules = rulesFor(surface);
      expect(
        rules.some((rule) => declares(rule, 'flex')?.startsWith('1')),
        `${surface} never declares a growing flex`,
      ).toBe(true);
      for (const rule of rules) {
        expect(declares(rule, 'height') ?? 'auto', rule.selector).not.toMatch(/100(vh|%)/);
        expect(declares(rule, 'min-height') ?? '0', rule.selector).not.toMatch(/100vh/);
      }
    }
  });

  it('owns its scrolling, rather than leaving it to the document', () => {
    // Asserted positively. Simply banning `overflow: visible` passes when the
    // declaration is deleted altogether, and the default *is* visible - which
    // is the exact state that scrolled the nav off the narrow studio surface.
    for (const surface of SURFACES) {
      const owning = rulesFor(surface).filter((rule) => {
        const value = scrollOwnership(rule);
        return value !== undefined && OWNS_ITS_SCROLL.includes(value);
      });
      expect(owning.length, `${surface} declares no overflow that owns its scroll`).toBeGreaterThan(
        0,
      );
    }
  });

  it('never lets the document become the scroll container', () => {
    for (const surface of SURFACES) {
      for (const rule of rulesFor(surface)) {
        expect(scrollOwnership(rule), rule.selector).not.toBe('visible');
      }
    }
  });

  it('keeps the narrow studio scrolling itself, where it outgrows the viewport', () => {
    // The one surface that genuinely cannot fit: its workspace stacks into a
    // single column. Pinned to its own media context so a rule elsewhere cannot
    // satisfy this by accident.
    const narrow = rulesFor('studio-surface').filter(
      (rule) => rule.media !== null && /max-width:\s*1050px/.test(rule.media),
    );
    expect(narrow.length, 'no .studio-surface rule under max-width: 1050px').toBeGreaterThan(0);

    const owning = narrow.filter((rule) => {
      const value = scrollOwnership(rule);
      return value === 'auto' || value === 'scroll';
    });
    expect(
      owning.length,
      'narrow .studio-surface must scroll itself, not the document',
    ).toBeGreaterThan(0);
  });
});
