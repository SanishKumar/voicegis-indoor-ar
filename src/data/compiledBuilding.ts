import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { PoiSource, SpaceSource } from '@voicegis/spatial-schema';
import referencePackageJson from '../../buildings/reference-medical-centre/compiled/building.package.json';
import type { GraphEdge, GraphNode, PoiMetadata } from '../engine/routingCore';

export const BUILDING_PACKAGE = referencePackageJson as unknown as CompiledBuildingPackage;

export const CATEGORIES = {
  medical: {
    id: 'medical',
    label: 'Medical',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.15)',
    icon: 'M',
  },
  diagnostic: {
    id: 'diagnostic',
    label: 'Diagnostic',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.15)',
    icon: 'D',
  },
  pharmacy: {
    id: 'pharmacy',
    label: 'Pharmacy',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.15)',
    icon: 'Rx',
  },
  service: {
    id: 'service',
    label: 'Services',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.15)',
    icon: 'S',
  },
  entrance: {
    id: 'entrance',
    label: 'Entrance',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.15)',
    icon: 'E',
  },
  restroom: {
    id: 'restroom',
    label: 'Restroom',
    color: '#64748b',
    bgColor: 'rgba(100, 116, 139, 0.15)',
    icon: 'WC',
  },
  staff: {
    id: 'staff',
    label: 'Staff',
    color: '#e11d48',
    bgColor: 'rgba(225, 29, 72, 0.15)',
    icon: 'ID',
  },
} as const;

export type CategoryId = keyof typeof CATEGORIES;

export interface VisitorPoiMetadata extends PoiMetadata {
  sourceId: string;
  floorId: string;
  floorName: string;
  spaceId: string;
  spaceName: string;
  public: boolean;
  accessible: boolean;
  aliases: string[];
}

export interface VisitorPoiNode extends GraphNode {
  type: 'poi';
  poi: VisitorPoiMetadata;
}

const floorsById = new Map(BUILDING_PACKAGE.floors.map((floor) => [floor.id, floor]));
const spacesById = new Map(BUILDING_PACKAGE.spaces.map((space) => [space.id, space]));
const poisById = new Map(BUILDING_PACKAGE.pois.map((poi) => [poi.id, poi]));

function describePoi(poi: PoiSource, space: SpaceSource) {
  const floor = floorsById.get(poi.floorId);
  return `${space.name} · ${floor?.name ?? poi.floorId}`;
}

function poiMetadata(poi: PoiSource): VisitorPoiMetadata | undefined {
  const space = spacesById.get(poi.spaceId);
  const floor = floorsById.get(poi.floorId);
  if (!space || !floor) return undefined;
  return {
    sourceId: poi.id,
    name: poi.name,
    category: poi.category,
    icon: CATEGORIES[poi.category as CategoryId]?.icon ?? 'P',
    description: describePoi(poi, space),
    floorId: floor.id,
    floorName: floor.name,
    spaceId: space.id,
    spaceName: space.name,
    public: poi.public && space.public,
    accessible: poi.accessible && space.accessible,
    aliases: poi.aliases ?? [],
  };
}

export const ROUTING_NODES: GraphNode[] = BUILDING_PACKAGE.routing.nodes.map((node) => {
  const poi = node.kind === 'poi' ? poisById.get(node.sourceId) : undefined;
  return {
    id: node.id,
    x: node.position[0],
    y: node.position[1],
    floor: node.floorId,
    floorName: floorsById.get(node.floorId)?.name ?? node.floorId,
    type: node.kind,
    sourceId: node.sourceId,
    poi: poi ? poiMetadata(poi) : undefined,
  };
});

export const ROUTING_EDGES: GraphEdge[] = BUILDING_PACKAGE.routing.edges.map((edge) => ({
  from: edge.from,
  to: edge.to,
  distance: edge.distanceMeters,
  corridor: edge.spaceId ? spacesById.get(edge.spaceId)?.name : undefined,
  accessible: edge.accessible,
  restricted: edge.restricted,
  kind: edge.kind,
  connectorKind: edge.connectorKind,
  sourceId: edge.sourceId,
}));

const nodesById = new Map(ROUTING_NODES.map((node) => [node.id, node]));
const visitorPois = ROUTING_NODES.filter((node): node is VisitorPoiNode => Boolean(node.poi));

export function getPOIs(options: { includeRestricted?: boolean } = {}): VisitorPoiNode[] {
  if (options.includeRestricted) return [...visitorPois];
  return visitorPois.filter((node) => node.poi.public);
}

export function getNodeById(id: string | null | undefined): GraphNode | null {
  if (!id) return null;
  return nodesById.get(id) ?? null;
}

export function getPOIsByCategory(category: string): VisitorPoiNode[] {
  return getPOIs().filter((node) => node.poi.category === category);
}

export function getFloorById(id: string) {
  return floorsById.get(id) ?? null;
}

export function getSpaceById(id: string) {
  return spacesById.get(id) ?? null;
}

export function getDefaultStartNodeId(): string {
  const entryPoi = visitorPois.find(
    (node) => node.poi.spaceId === BUILDING_PACKAGE.building.entrySpaceId && node.poi.public,
  );
  if (!entryPoi) throw new Error('The compiled building has no public POI in its entry space.');
  return entryPoi.id;
}
