import type {
  BuildingSource,
  Coordinate2D,
  FloorSource,
  SpaceSource,
} from '@voicegis/spatial-schema';

export const FLOOR_CANVAS_SNAP_METERS = 0.5;

export interface FloorCanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function snapCoordinate(value: number, step = FLOOR_CANVAS_SNAP_METERS) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const snapped = Math.round(value / step) * step;
  return Object.is(snapped, -0) ? 0 : Number(snapped.toFixed(6));
}

export function snapPoint(point: Coordinate2D, step = FLOOR_CANVAS_SNAP_METERS): Coordinate2D {
  return [snapCoordinate(point[0], step), snapCoordinate(point[1], step)];
}

export function getFloorCanvasBounds(floor: FloorSource): FloorCanvasBounds {
  const xValues = floor.outline.map(([x]) => x);
  const yValues = floor.outline.map(([, y]) => y);
  const minX = Math.min(...xValues);
  const minY = Math.min(...yValues);
  const maxX = Math.max(...xValues);
  const maxY = Math.max(...yValues);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

export function getSpacesForFloor(source: BuildingSource, floorId: string): SpaceSource[] {
  return source.spaces.filter((space) => space.floorId === floorId);
}

export function updateSpacePolygonVertex(
  source: BuildingSource,
  spaceId: string,
  vertexIndex: number,
  point: Coordinate2D,
): BuildingSource {
  const spaceIndex = source.spaces.findIndex((space) => space.id === spaceId);
  const space = source.spaces[spaceIndex];
  if (!space || vertexIndex < 0 || vertexIndex >= space.polygon.length) return source;

  const polygon = space.polygon.map(
    (vertex, index) => (index === vertexIndex ? [...point] : vertex) as Coordinate2D,
  );
  const spaces = source.spaces.map((candidate, index) =>
    index === spaceIndex ? { ...candidate, polygon } : candidate,
  );

  return { ...source, spaces };
}
