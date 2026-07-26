import type { Coordinate2D } from '@voicegis/spatial-schema';
import type { GraphNode } from './routingCore';

export function polygonCentroid(points: Coordinate2D[]): Coordinate2D {
  if (points.length === 0) return [0, 0];

  let signedArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    signedArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }

  signedArea *= 0.5;
  if (Math.abs(signedArea) < Number.EPSILON) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }

  return [x / (6 * signedArea), y / (6 * signedArea)];
}

export function routeSegmentsForFloor(
  path: GraphNode[],
  floorId: string,
): Array<[GraphNode, GraphNode]> {
  const segments: Array<[GraphNode, GraphNode]> = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (String(from.floor) === floorId && String(to.floor) === floorId) {
      segments.push([from, to]);
    }
  }
  return segments;
}

export interface FloorTransition {
  node: GraphNode;
  targetFloorId: string;
}

export interface RouteConnectorRun {
  connectorId: string;
  fromFloorId: string;
  toFloorId: string;
  floorIds: string[];
  nodes: GraphNode[];
}

export function routeFloorIds(path: GraphNode[]) {
  const floorIds: string[] = [];
  for (const node of path) {
    const floorId = String(node.floor);
    if (floorIds.at(-1) !== floorId) floorIds.push(floorId);
  }
  return floorIds;
}

export function routeConnectorRuns(path: GraphNode[]): RouteConnectorRun[] {
  const runs: RouteConnectorRun[] = [];

  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    const fromFloorId = String(from.floor);
    const toFloorId = String(to.floor);
    if (fromFloorId === toFloorId) continue;

    const connectorId =
      from.sourceId && from.sourceId === to.sourceId
        ? from.sourceId
        : `transition:${from.id}:${to.id}`;
    const previous = runs.at(-1);
    if (previous?.connectorId === connectorId && previous.toFloorId === fromFloorId) {
      previous.toFloorId = toFloorId;
      previous.floorIds.push(toFloorId);
      previous.nodes.push(to);
      continue;
    }

    runs.push({
      connectorId,
      fromFloorId,
      toFloorId,
      floorIds: [fromFloorId, toFloorId],
      nodes: [from, to],
    });
  }

  return runs;
}

export function floorTransitions(path: GraphNode[], floorId: string): FloorTransition[] {
  const transitions: FloorTransition[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (String(from.floor) === String(to.floor)) continue;
    if (String(from.floor) === floorId) {
      transitions.push({ node: from, targetFloorId: String(to.floor) });
    }
    if (String(to.floor) === floorId) {
      transitions.push({ node: to, targetFloorId: String(from.floor) });
    }
  }
  return transitions;
}
