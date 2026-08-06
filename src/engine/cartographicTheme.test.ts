import { describe, expect, it } from 'vitest';
import type { SpaceType } from '@voicegis/spatial-schema';
import {
  CARTOGRAPHIC_THEME,
  spaceSurface,
  spaceSurfaceFills,
  wallSurface,
  wallSurfaceClass,
} from './cartographicTheme';

const SPACE_TYPES: SpaceType[] = [
  'entrance',
  'room',
  'corridor',
  'lobby',
  'service',
  'restricted',
  'vertical-circulation',
];

const HEX = /^#[0-9a-f]{6}$/;

describe('cartographic theme', () => {
  it('defines a complete surface for every space type', () => {
    for (const type of SPACE_TYPES) {
      const surface = spaceSurface(type);
      expect(surface.fill).toMatch(HEX);
      expect(surface.outline).toMatch(HEX);
      expect(surface.surface).toMatch(HEX);
    }
    expect(Object.keys(spaceSurfaceFills()).sort()).toEqual([...SPACE_TYPES].sort());
  });

  it('gives the 2D plan and the 3D twin the same source of truth', () => {
    // The renderers previously hardcoded separate palettes, so the same venue
    // looked like two products. Every 2D fill must come from the same token the
    // twin reads its surface from.
    for (const type of SPACE_TYPES) {
      expect(spaceSurfaceFills()[type]).toBe(spaceSurface(type).fill);
    }
  });

  it('separates an interior partition from the exterior envelope', () => {
    const exterior = wallSurface('exterior');
    const interior = wallSurface('interior');

    expect(exterior.color).not.toBe(interior.color);
    // The envelope stands full height so the building edge still reads from above.
    expect(exterior.heightScale).toBeGreaterThan(interior.heightScale);
    expect(exterior.heightScale).toBe(1);
  });

  it('classifies a boundary from the spaces it separates', () => {
    expect(wallSurfaceClass('interior', [{ type: 'room', public: true }])).toBe('interior');
    expect(wallSurfaceClass('exterior', [{ type: 'room', public: true }])).toBe('exterior');
    expect(wallSurfaceClass('exterior', [{ type: 'entrance', public: true }])).toBe('glazed');
    expect(
      wallSurfaceClass('interior', [
        { type: 'entrance', public: true },
        { type: 'room', public: true },
      ]),
    ).toBe('interior');
  });

  it('lets restriction win over glazing', () => {
    // A restricted boundary must never be softened into a glass facade.
    expect(
      wallSurfaceClass('exterior', [
        { type: 'entrance', public: true },
        { type: 'restricted', public: false },
      ]),
    ).toBe('restricted');
    expect(wallSurfaceClass('interior', [{ type: 'room', public: false }])).toBe('restricted');
  });

  it('only makes the glazed class transparent', () => {
    expect(wallSurface('glazed').transmission).toBeGreaterThan(0);
    expect(wallSurface('glazed').opacity).toBeLessThan(1);
    for (const surfaceClass of ['exterior', 'interior', 'restricted'] as const) {
      expect(wallSurface(surfaceClass).transmission).toBe(0);
      expect(wallSurface(surfaceClass).opacity).toBe(1);
    }
  });

  it('keeps shared drawing constants in one place', () => {
    expect(CARTOGRAPHIC_THEME.wallThicknessMeters).toBeGreaterThan(0);
    expect(CARTOGRAPHIC_THEME.plan.floor).toMatch(HEX);
    expect(CARTOGRAPHIC_THEME.accent.restricted).toMatch(HEX);
  });
});
