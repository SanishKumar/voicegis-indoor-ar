import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { LiveSessionOptions, RouteMatchSegment } from '@voicegis/localization-core';
import { verifyVenuePackage } from '../data/venuePackageContract';
import { createCompiledBuildingRuntime } from '../data/compiledBuilding';
import {
  calculateCompiledRoute,
  type CompiledRouteOptions,
  type ExplainedRouteResult,
} from '../engine/compiledRoutePolicy';
import { reflectPlanFilterPosition } from './coordinateFrames';

export interface DiagnosticSessionRequest {
  buildingPackage: CompiledBuildingPackage;
  route: ExplainedRouteResult;
  policy: CompiledRouteOptions;
  sessionId: string;
  routeRevision: number;
}

/** Operator-only preparation, not automatic Visitor enrollment. Revalidate the
 * package bytes and current policy, then use canonical graph geometry (not UI
 * copies) to cross the plan/filter boundary exactly once. */
export async function prepareDiagnosticSession(
  request: DiagnosticSessionRequest,
): Promise<LiveSessionOptions> {
  const { buildingPackage, route, policy, sessionId, routeRevision } = structuredClone(request);
  if (!route?.found || !route.receipt)
    throw new Error('A successful route with a policy receipt is required.');
  const pkg = await verifyVenuePackage(buildingPackage);
  const runtime = createCompiledBuildingRuntime(pkg);
  const checked = calculateCompiledRoute(
    runtime,
    route.receipt.startId,
    route.receipt.destinationId,
    policy,
  );
  if (
    !checked.found ||
    route.receipt.status !== 'routed' ||
    route.receipt.buildingId !== pkg.building.id ||
    route.receipt.packageHash !== pkg.manifest.contentHash ||
    route.receipt.profile !== checked.receipt.profile ||
    route.receipt.operationalOverlayId !== checked.receipt.operationalOverlayId ||
    route.receipt.evaluatedAt !== checked.receipt.evaluatedAt ||
    JSON.stringify(route.receipt.appliedClosureIds) !==
      JSON.stringify(checked.receipt.appliedClosureIds) ||
    JSON.stringify(route.pathIds) !== JSON.stringify(checked.pathIds)
  ) {
    throw new Error(
      'The selected journey does not match the current route policy. Plan it again in Visitor view.',
    );
  }

  const nodes = new Map(pkg.routing.nodes.map((node) => [node.id, node]));
  const pair = (from: string, to: string) => JSON.stringify([from, to].sort());
  const edges = new Map(pkg.routing.edges.map((edge) => [pair(edge.from, edge.to), edge]));
  const routeSegments: RouteMatchSegment[] = [];
  let progress = 0;
  for (let index = 1; index < checked.pathIds.length; index += 1) {
    const from = nodes.get(checked.pathIds[index - 1])!;
    const to = nodes.get(checked.pathIds[index])!;
    const edge = edges.get(pair(from.id, to.id));
    if (!edge) throw new Error('The route contains a missing graph edge.');
    if (from.floorId !== to.floorId || edge.kind === 'vertical-connector') {
      // Retain a gap in route distance, never draw a fabricated horizontal link.
      progress += edge.distanceMeters;
      continue;
    }
    const lengthMeters = Math.hypot(
      to.position[0] - from.position[0],
      to.position[1] - from.position[1],
    );
    if (lengthMeters === 0) continue;
    routeSegments.push({
      id: `${index}:${edge.id}`,
      floorId: from.floorId,
      from: reflectPlanFilterPosition(from.position),
      to: reflectPlanFilterPosition(to.position),
      startProgressMeters: progress,
      lengthMeters,
    });
    progress += lengthMeters;
  }
  if (routeSegments.length === 0)
    throw new Error('The route has no horizontal segments to diagnose.');
  return {
    identity: {
      sessionId,
      routeRevision,
      buildingId: pkg.building.id,
      packageHash: pkg.manifest.contentHash,
    },
    anchors: pkg.localizationAnchors.map((anchor) => ({
      ...anchor,
      position: reflectPlanFilterPosition(anchor.position),
    })),
    elevationByFloorId: Object.fromEntries(pkg.floors.map((floor) => [floor.id, floor.elevation])),
    routeSegments,
  };
}
