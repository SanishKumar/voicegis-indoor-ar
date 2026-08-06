import type { SpaceSource, SpaceType } from '@voicegis/spatial-schema';
import type { WallBodyKind } from './wallTopology';

/**
 * One palette for every view of a venue.
 *
 * The 2D plan and the 3D twin previously hardcoded separate colours for the
 * same semantic classes, so an entrance was one colour on the plan and another
 * in the twin and the venue read as two unrelated products. Both renderers now
 * resolve appearance from here, which keeps the views coherent and leaves a
 * single place to rebrand.
 *
 * The palette is warm architectural neutral — the convention printed floor
 * plans use — so saturated colour is spent on wayfinding meaning rather than on
 * the building fabric.
 */

export type WallSurfaceClass = WallBodyKind | 'restricted' | 'glazed';

export interface SpaceSurface {
  /** Flat fill used by the 2D plan. */
  fill: string;
  /** Outline used by the 2D plan. */
  outline: string;
  /** Base colour for the extruded slab in the 3D twin. */
  surface: string;
}

export interface WallSurface {
  color: string;
  roughness: number;
  metalness: number;
  /** Fraction of the floor's clear height this wall class is drawn at. */
  heightScale: number;
  transmission: number;
  opacity: number;
}

const SPACE_SURFACES: Record<SpaceType, SpaceSurface> = {
  entrance: { fill: '#dceff0', outline: '#8fb6b8', surface: '#cfe7e9' },
  room: { fill: '#f3efe7', outline: '#c3bcab', surface: '#e9e3d6' },
  corridor: { fill: '#ffffff', outline: '#cfd6d2', surface: '#f6f7f4' },
  lobby: { fill: '#eef2ed', outline: '#b9c5bd', surface: '#e2e9e1' },
  service: { fill: '#e6edf2', outline: '#a9bccb', surface: '#d8e3ea' },
  restricted: { fill: '#f2dfe2', outline: '#c08f97', surface: '#e8ccd1' },
  'vertical-circulation': { fill: '#e1e8e5', outline: '#a8b8b1', surface: '#d3ddd9' },
};

const WALL_SURFACES: Record<WallSurfaceClass, WallSurface> = {
  // Exterior envelope reads heaviest and stands full height.
  exterior: {
    color: '#59645f',
    roughness: 0.78,
    metalness: 0.02,
    heightScale: 1,
    transmission: 0,
    opacity: 1,
  },
  // Interior partitions sit slightly lower and lighter so the envelope still
  // reads as the building edge from above.
  interior: {
    color: '#b8bdb5',
    roughness: 0.72,
    metalness: 0.02,
    heightScale: 0.94,
    transmission: 0,
    opacity: 1,
  },
  restricted: {
    color: '#a54b55',
    roughness: 0.68,
    metalness: 0.04,
    heightScale: 0.96,
    transmission: 0,
    opacity: 1,
  },
  glazed: {
    color: '#9fd3dc',
    roughness: 0.08,
    metalness: 0.08,
    heightScale: 0.9,
    transmission: 0.58,
    opacity: 0.68,
  },
};

export const CARTOGRAPHIC_THEME = {
  wallThicknessMeters: 0.12,
  plan: {
    paper: '#fdfdf9',
    floor: '#f7f8f4',
    background: 'radial-gradient(circle at 48% 42%, #fbfcfa 0%, #eef2ef 54%, #dfe5e1 100%)',
  },
  accent: {
    accessible: '#176b5b',
    restricted: '#a54b55',
    standard: '#b9782d',
  },
} as const;

export function spaceSurface(type: SpaceType): SpaceSurface {
  return SPACE_SURFACES[type];
}

export function spaceSurfaceFills(): Record<SpaceType, string> {
  return Object.fromEntries(
    Object.entries(SPACE_SURFACES).map(([type, surface]) => [type, surface.fill]),
  ) as Record<SpaceType, string>;
}

/**
 * Chooses the wall class for a run from the spaces it separates. Restriction
 * wins over glazing: a wall bounding a restricted space must read as restricted
 * even where it is also an entrance facade.
 */
export function wallSurfaceClass(
  kind: WallBodyKind,
  spaces: Pick<SpaceSource, 'type' | 'public'>[],
): WallSurfaceClass {
  if (spaces.some((space) => space.type === 'restricted' || space.public === false)) {
    return 'restricted';
  }
  if (spaces.length > 0 && spaces.every((space) => space.type === 'entrance')) return 'glazed';
  return kind;
}

export function wallSurface(surfaceClass: WallSurfaceClass): WallSurface {
  return WALL_SURFACES[surfaceClass];
}
