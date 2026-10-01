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
  // Dark plates on a black canvas: walkable space is the lightest, and the
  // one hue that is not a cool grey marks what a visitor may not enter.
  entrance: { fill: '#3a4a5f', outline: '#8ea0b6', surface: '#3a4a5f' },
  room: { fill: '#171c24', outline: '#5d6b7c', surface: '#1b212b' },
  corridor: { fill: '#28323f', outline: '#6f7f92', surface: '#28323f' },
  lobby: { fill: '#2f3b4b', outline: '#7d8da1', surface: '#2f3b4b' },
  service: { fill: '#141a1f', outline: '#4b5766', surface: '#161c22' },
  restricted: { fill: '#2a1d20', outline: '#7a4a52', surface: '#2a1d20' },
  'vertical-circulation': { fill: '#426188', outline: '#8fa9c8', surface: '#426188' },
};

const WALL_SURFACES: Record<WallSurfaceClass, WallSurface> = {
  // Exterior envelope reads heaviest and stands full height.
  exterior: {
    color: '#b9c4d2',
    roughness: 0.78,
    metalness: 0.02,
    heightScale: 1,
    transmission: 0,
    opacity: 1,
  },
  // Interior partitions sit slightly lower and lighter so the envelope still
  // reads as the building edge from above.
  interior: {
    color: '#8794a5',
    roughness: 0.72,
    metalness: 0.02,
    heightScale: 0.94,
    transmission: 0,
    opacity: 1,
  },
  restricted: {
    color: '#7a4a52',
    roughness: 0.68,
    metalness: 0.04,
    heightScale: 0.96,
    transmission: 0,
    opacity: 1,
  },
  glazed: {
    color: '#a9c4dc',
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
    paper: '#000000',
    floor: '#0c0f14',
    background: '#000000',
  },
  accent: {
    accessible: '#8fb4c9',
    restricted: '#7a4a52',
    standard: '#c2a36b',
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
