import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { Coordinate2D, FloorSource, SpaceSource } from '@voicegis/spatial-schema';

export const EXPLODED_FLOOR_GAP_METERS = 4;

export interface BuildingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
  center: Coordinate2D;
}

export type FloorSelection = 'all' | string;

export interface VisibleSpaceOptions {
  floorId: FloorSelection;
  includeRestricted: boolean;
}

export interface GraphSummary {
  nodeCount: number;
  edgeCount: number;
  accessibleEdgeCount: number;
  restrictedEdgeCount: number;
  verticalEdgeCount: number;
}

export function computeBuildingBounds(
  buildingPackage: Pick<CompiledBuildingPackage, 'floors'>,
): BuildingBounds {
  const points = buildingPackage.floors.flatMap((floor) => floor.outline);
  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      depth: 0,
      center: [0, 0],
    };
  }

  const xValues = points.map(([x]) => x);
  const yValues = points.map(([, y]) => y);
  const minX = Math.min(...xValues);
  const minY = Math.min(...yValues);
  const maxX = Math.max(...xValues);
  const maxY = Math.max(...yValues);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    depth: maxY - minY,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
  };
}

export function visualFloorElevation(floor: FloorSource, exploded: boolean): number {
  return floor.elevation + (exploded ? floor.level * EXPLODED_FLOOR_GAP_METERS : 0);
}

export function mapCoordinateToWorld(
  coordinate: Coordinate2D,
  elevation: number,
  bounds: BuildingBounds,
): [number, number, number] {
  return [coordinate[0] - bounds.center[0], elevation, coordinate[1] - bounds.center[1]];
}

export function isSpaceRestricted(space: SpaceSource): boolean {
  return !space.public || space.type === 'restricted';
}

export function getVisibleSpaces(
  buildingPackage: Pick<CompiledBuildingPackage, 'spaces'>,
  options: VisibleSpaceOptions,
): SpaceSource[] {
  return buildingPackage.spaces.filter((space) => {
    const onSelectedFloor = options.floorId === 'all' || space.floorId === options.floorId;
    const allowedByPolicy = options.includeRestricted || !isSpaceRestricted(space);
    return onSelectedFloor && allowedByPolicy;
  });
}

export function getGraphSummary(
  buildingPackage: Pick<CompiledBuildingPackage, 'routing'>,
): GraphSummary {
  return {
    nodeCount: buildingPackage.routing.nodes.length,
    edgeCount: buildingPackage.routing.edges.length,
    accessibleEdgeCount: buildingPackage.routing.edges.filter((edge) => edge.accessible).length,
    restrictedEdgeCount: buildingPackage.routing.edges.filter((edge) => edge.restricted).length,
    verticalEdgeCount: buildingPackage.routing.edges.filter(
      (edge) => edge.kind === 'vertical-connector',
    ).length,
  };
}
