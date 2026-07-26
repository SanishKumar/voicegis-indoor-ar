import type { CompiledBuildingRuntime } from '../data/compiledBuilding';
import {
  calculateRoute,
  type RouteFailure,
  type RouteOptions,
  type RouteSuccess,
} from './routingCore';
import {
  resolveOperationalOverlay,
  type OperationalOverlay,
  type OverlayIssue,
} from './operationalOverlay';

export const ROUTE_RECEIPT_VERSION = '0.1.0' as const;
export type RoutingProfile = 'standard' | 'wheelchair';

export interface CompiledRouteOptions extends Omit<
  RouteOptions,
  'accessibleOnly' | 'closedEdgeIds'
> {
  profile?: RoutingProfile;
  accessibleOnly?: boolean;
  operationalOverlay?: OperationalOverlay;
  evaluatedAt?: string;
}

export interface SelectedConnectorReceipt {
  sourceId: string;
  kind: string;
  fromFloorId: string;
  toFloorId: string;
}

export interface RouteReceipt {
  receiptVersion: typeof ROUTE_RECEIPT_VERSION;
  buildingId: string;
  packageHash: string;
  profile: RoutingProfile;
  startId: string;
  destinationId: string;
  status: 'routed' | 'unroutable' | 'rejected';
  totalDistanceMeters: number | null;
  operationalOverlayId: string | null;
  evaluatedAt: string | null;
  appliedClosureIds: string[];
  selectedConnectors: SelectedConnectorReceipt[];
  excludedEdges: {
    restricted: number;
    inaccessible: number;
    closed: number;
  };
  overlayIssues: OverlayIssue[];
}

export type ExplainedRouteResult = (RouteSuccess | RouteFailure) & { receipt: RouteReceipt };

function pairKey(a: string, b: string) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function selectedConnectors(
  venue: CompiledBuildingRuntime,
  pathIds: string[],
): SelectedConnectorReceipt[] {
  const edgesByPair = new Map(
    venue.routingEdges.map((edge) => [pairKey(edge.from, edge.to), edge] as const),
  );
  const connectors = new Map<string, SelectedConnectorReceipt>();
  for (let index = 0; index < pathIds.length - 1; index += 1) {
    const edge = edgesByPair.get(pairKey(pathIds[index], pathIds[index + 1]));
    if (!edge || edge.kind !== 'vertical-connector' || !edge.sourceId) continue;
    const from = venue.getNodeById(pathIds[index]);
    const to = venue.getNodeById(pathIds[index + 1]);
    if (!from || !to) continue;
    const existing = connectors.get(edge.sourceId);
    connectors.set(edge.sourceId, {
      sourceId: edge.sourceId,
      kind: edge.connectorKind ?? 'vertical-connector',
      fromFloorId: existing?.fromFloorId ?? String(from.floor),
      toFloorId: String(to.floor),
    });
  }
  return [...connectors.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export function calculateCompiledRoute(
  venue: CompiledBuildingRuntime,
  startId: string,
  destinationId: string,
  options: CompiledRouteOptions = {},
): ExplainedRouteResult {
  const { buildingPackage, routingEdges, routingNodes } = venue;
  const profile: RoutingProfile =
    options.profile ?? (options.accessibleOnly ? 'wheelchair' : 'standard');
  const overlay = options.operationalOverlay;
  const overlayResolution = overlay
    ? resolveOperationalOverlay(overlay, buildingPackage, options.evaluatedAt ?? '')
    : null;
  const baseReceipt: Omit<RouteReceipt, 'status' | 'totalDistanceMeters' | 'selectedConnectors'> = {
    receiptVersion: ROUTE_RECEIPT_VERSION,
    buildingId: buildingPackage.building.id,
    packageHash: buildingPackage.manifest.contentHash,
    profile,
    startId,
    destinationId,
    operationalOverlayId: overlay?.id ?? null,
    evaluatedAt: overlay ? (options.evaluatedAt ?? null) : null,
    appliedClosureIds: overlayResolution?.activeClosureIds ?? [],
    excludedEdges: {
      restricted: options.allowRestricted
        ? 0
        : routingEdges.filter((edge) => edge.restricted).length,
      inaccessible:
        profile === 'wheelchair'
          ? routingEdges.filter((edge) => edge.accessible === false).length
          : 0,
      closed: overlayResolution?.closedEdgeIds.length ?? 0,
    },
    overlayIssues: overlayResolution?.issues ?? [],
  };

  if (overlayResolution && !overlayResolution.valid) {
    return {
      found: false,
      error: `Operational overlay rejected: ${overlayResolution.issues.map((issue) => issue.code).join(', ')}.`,
      receipt: {
        ...baseReceipt,
        status: 'rejected',
        totalDistanceMeters: null,
        selectedConnectors: [],
      },
    };
  }

  const route = calculateRoute(startId, destinationId, routingNodes, routingEdges, {
    accessibleOnly: profile === 'wheelchair',
    allowRestricted: options.allowRestricted,
    closedEdgeIds: overlayResolution?.closedEdgeIds,
  });
  return {
    ...route,
    receipt: {
      ...baseReceipt,
      status: route.found ? 'routed' : 'unroutable',
      totalDistanceMeters: route.found ? route.totalDistance : null,
      selectedConnectors: route.found ? selectedConnectors(venue, route.pathIds) : [],
    },
  };
}
