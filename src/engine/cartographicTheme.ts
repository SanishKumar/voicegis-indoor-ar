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
  // A white model in the sky: walkable space is pure white, rooms step down
  // through pale blues, and the one warm tone marks what a visitor may not enter.
  entrance: { fill: '#f4f9ff', outline: '#9fb9da', surface: '#f4f9ff' },
  room: { fill: '#dce8f8', outline: '#9fb5d2', surface: '#dce8f8' },
  corridor: { fill: '#ffffff', outline: '#b5c8e2', surface: '#ffffff' },
  lobby: { fill: '#f8fbff', outline: '#a9c0de', surface: '#f8fbff' },
  service: { fill: '#c8d8ee', outline: '#8ea6c6', surface: '#c8d8ee' },
  restricted: { fill: '#f0d6da', outline: '#c98b96', surface: '#f0d6da' },
  'vertical-circulation': { fill: '#8fb8f0', outline: '#5f8fd6', surface: '#8fb8f0' },
};

const WALL_SURFACES: Record<WallSurfaceClass, WallSurface> = {
  // Exterior envelope reads heaviest and stands full height.
  exterior: {
    color: '#ffffff',
    roughness: 0.78,
    metalness: 0.02,
    heightScale: 1,
    transmission: 0,
    opacity: 1,
  },
  // Interior partitions sit slightly lower and lighter so the envelope still
  // reads as the building edge from above.
  interior: {
    color: '#e9f1fb',
    roughness: 0.72,
    metalness: 0.02,
    heightScale: 0.94,
    transmission: 0,
    opacity: 1,
  },
  restricted: {
    color: '#e2a9b3',
    roughness: 0.68,
    metalness: 0.04,
    heightScale: 0.96,
    transmission: 0,
    opacity: 1,
  },
  glazed: {
    color: '#bfe2f4',
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
    paper: '#ffffff',
    floor: '#eef3fa',
    background: 'transparent',
  },
  accent: {
    accessible: '#7fd3e6',
    restricted: '#e2a9b3',
    standard: '#f0cf8a',
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
