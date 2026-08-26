/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SurfaceNav from './SurfaceNav.jsx';

/**
 * Every operator link must be announceable.
 *
 * This nav renders only on the operator surfaces now; the visitor shell shows
 * no control that leads to them. "Visitor view" stays so an operator can get
 * back without editing the URL.
 *
 * Below 700px the label span is `display: none` and the icon carries
 * `aria-hidden`, so the links had no accessible name at all: a screen reader
 * found four links to nowhere. The name cannot come from the visible text
 * because at that width there is none.
 */

afterEach(cleanup);

const SURFACES = ['Visitor view', '3D + venues', 'Studio', 'Record'];

describe('surface navigation naming', () => {
  it('gives every link a name that does not depend on the label being visible', () => {
    render(<SurfaceNav activeSurface="visitor" />);

    for (const name of SURFACES) {
      const link = screen.getByRole('link', { name });
      expect(link, name).toBeDefined();
      expect(link.getAttribute('aria-label'), name).toBe(name);
    }
  });

  it('marks only the active surface as the current page', () => {
    render(<SurfaceNav activeSurface="studio" />);

    expect(screen.getByRole('link', { name: 'Studio' }).getAttribute('aria-current')).toBe('page');
    for (const name of SURFACES.filter((surface) => surface !== 'Studio')) {
      expect(screen.getByRole('link', { name }).getAttribute('aria-current'), name).toBeNull();
    }
  });

  it('keeps the icons out of the accessible name', () => {
    // Decorative, and a duplicated name is worse than none.
    const { container } = render(<SurfaceNav activeSurface="visitor" />);
    const icons = container.querySelectorAll('svg');

    expect(icons.length).toBe(SURFACES.length);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
