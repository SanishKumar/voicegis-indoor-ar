import { BUILDING_PACKAGE, ROUTING_EDGES, ROUTING_NODES } from '../data/compiledBuilding';
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

const edgesByPair = new Map(
  ROUTING_EDGES.map((edge) => [pairKey(edge.from, edge.to), edge] as const),
);

function selectedConnectors(pathIds: string[]): SelectedConnectorReceipt[] {
  const connectors = new Map<string, SelectedConnectorReceipt>();
  for (let index = 0; index < pathIds.length - 1; index += 1) {
    const edge = edgesByPair.get(pairKey(pathIds[index], pathIds[index + 1]));
    if (!edge || edge.kind !== 'vertical-connector' || !edge.sourceId) continue;
    const from = ROUTING_NODES.find((node) => node.id === pathIds[index]);
    const to = ROUTING_NODES.find((node) => node.id === pathIds[index + 1]);
    if (!from || !to) continue;
    connectors.set(edge.sourceId, {
      sourceId: edge.sourceId,
      kind: edge.connectorKind ?? 'vertical-connector',
      fromFloorId: String(from.floor),
      toFloorId: String(to.floor),
    });
  }
  return [...connectors.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export function calculateCompiledRoute(
  startId: string,
  destinationId: string,
  options: CompiledRouteOptions = {},
): ExplainedRouteResult {
  const profile: RoutingProfile =
    options.profile ?? (options.accessibleOnly ? 'wheelchair' : 'standard');
  const overlay = options.operationalOverlay;
  const overlayResolution = overlay
    ? resolveOperationalOverlay(overlay, BUILDING_PACKAGE, options.evaluatedAt ?? '')
    : null;
  const baseReceipt: Omit<RouteReceipt, 'status' | 'totalDistanceMeters' | 'selectedConnectors'> = {
    receiptVersion: ROUTE_RECEIPT_VERSION,
    buildingId: BUILDING_PACKAGE.building.id,
    packageHash: BUILDING_PACKAGE.manifest.contentHash,
    profile,
    startId,
    destinationId,
    operationalOverlayId: overlay?.id ?? null,
    evaluatedAt: overlay ? (options.evaluatedAt ?? null) : null,
    appliedClosureIds: overlayResolution?.activeClosureIds ?? [],
    excludedEdges: {
      restricted: options.allowRestricted
        ? 0
        : ROUTING_EDGES.filter((edge) => edge.restricted).length,
      inaccessible:
        profile === 'wheelchair'
          ? ROUTING_EDGES.filter((edge) => edge.accessible === false).length
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

  const route = calculateRoute(startId, destinationId, ROUTING_NODES, ROUTING_EDGES, {
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
      selectedConnectors: route.found ? selectedConnectors(route.pathIds) : [],
    },
  };
}
