/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SurfaceNav from './SurfaceNav.jsx';

/**
 * Every operator link must be announceable.
 *
 * The public bundle has no operator tooling. In the operator build the labels
 * stay visible in the desktop rail and mobile dock, and the explicit names are
 * pinned here so visual and assistive labels cannot drift apart.
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
    const icons = container.querySelectorAll('.surface-nav-links svg');

    expect(icons.length).toBe(SURFACES.length);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');

    // The workbench mark is decorative as one hidden unit, including its text.
    expect(container.querySelector('.surface-nav-brand')?.getAttribute('aria-hidden')).toBe('true');
  });
});
