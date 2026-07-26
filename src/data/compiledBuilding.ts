import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { PoiSource, SpaceSource } from '@voicegis/spatial-schema';
import type { GraphEdge, GraphNode, PoiMetadata } from '../engine/routingCore';

export interface CategoryStyle {
  id: string;
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}

export const CATEGORIES: Record<string, CategoryStyle> = {
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
  emergency: {
    id: 'emergency',
    label: 'Emergency',
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.15)',
    icon: 'ER',
  },
  landmark: {
    id: 'landmark',
    label: 'Landmarks',
    color: '#0ea5e9',
    bgColor: 'rgba(14, 165, 233, 0.15)',
    icon: 'A',
  },
  food: {
    id: 'food',
    label: 'Food',
    color: '#ea580c',
    bgColor: 'rgba(234, 88, 12, 0.15)',
    icon: 'F',
  },
  family: {
    id: 'family',
    label: 'Family',
    color: '#db2777',
    bgColor: 'rgba(219, 39, 119, 0.15)',
    icon: '♥',
  },
  research: {
    id: 'research',
    label: 'Research',
    color: '#7c3aed',
    bgColor: 'rgba(124, 58, 237, 0.15)',
    icon: 'R',
  },
  education: {
    id: 'education',
    label: 'Education',
    color: '#4f46e5',
    bgColor: 'rgba(79, 70, 229, 0.15)',
    icon: 'ED',
  },
} as const;

const UNKNOWN_CATEGORY_COLORS = [
  ['#0891b2', 'rgba(8, 145, 178, 0.15)'],
  ['#7c3aed', 'rgba(124, 58, 237, 0.15)'],
  ['#be123c', 'rgba(190, 18, 60, 0.15)'],
] as const;

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

export interface BuildingConfig {
  name: string;
  subtitle: string;
  floors: {
    id: string;
    label: string;
    level: number;
    isDefault: boolean;
  }[];
  viewBox: {
    width: number;
    height: number;
  };
  defaultStartNode: string;
  defaultFloorId: string;
  walkSpeedMps: number;
  metersPerUnit: number;
}

export interface CompiledBuildingRuntime {
  key: string;
  buildingPackage: CompiledBuildingPackage;
  routingNodes: GraphNode[];
  routingEdges: GraphEdge[];
  config: BuildingConfig;
  categories: Record<string, CategoryStyle>;
  getCategory(categoryId: string): CategoryStyle;
  getPOIs(options?: { includeRestricted?: boolean }): VisitorPoiNode[];
  getNodeById(id: string | null | undefined): GraphNode | null;
  getPOIsByCategory(category: string): VisitorPoiNode[];
  getFloorById(id: string): CompiledBuildingPackage['floors'][number] | null;
  getSpaceById(id: string): CompiledBuildingPackage['spaces'][number] | null;
  getDefaultStartNodeId(): string;
}

function humanizeCategory(categoryId: string) {
  return categoryId
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function createCategoryStyles(pois: CompiledBuildingPackage['pois']) {
  const categories = { ...CATEGORIES };
  const unknownIds = [...new Set(pois.map((poi) => poi.category))]
    .filter((categoryId) => !categories[categoryId])
    .sort();
  unknownIds.forEach((categoryId, index) => {
    const [color, bgColor] = UNKNOWN_CATEGORY_COLORS[index % UNKNOWN_CATEGORY_COLORS.length];
    categories[categoryId] = {
      id: categoryId,
      label: humanizeCategory(categoryId) || 'Other',
      color,
      bgColor,
      icon: (categoryId[0] ?? 'P').toUpperCase(),
    };
  });
  return categories;
}

function createBuildingConfig(
  buildingPackage: CompiledBuildingPackage,
  defaultStartNode: string,
): BuildingConfig {
  const coordinates = buildingPackage.floors.flatMap((floor) => floor.outline);
  const xValues = coordinates.map(([x]) => x);
  const yValues = coordinates.map(([, y]) => y);
  const defaultFloor =
    buildingPackage.floors.find((floor) => floor.level === 0) ?? buildingPackage.floors[0];

  return {
    name: buildingPackage.building.name,
    subtitle: `${buildingPackage.floors.length}-floor verified venue package`,
    floors: buildingPackage.floors.map((floor) => ({
      id: floor.id,
      label: floor.name,
      level: floor.level,
      isDefault: floor.id === defaultFloor.id,
    })),
    viewBox: {
      width: Math.max(...xValues) - Math.min(...xValues),
      height: Math.max(...yValues) - Math.min(...yValues),
    },
    defaultStartNode,
    defaultFloorId: defaultFloor.id,
    walkSpeedMps: 1.2,
    metersPerUnit: 1,
  };
}

export function createCompiledBuildingRuntime(
  buildingPackage: CompiledBuildingPackage,
): CompiledBuildingRuntime {
  const floorsById = new Map(buildingPackage.floors.map((floor) => [floor.id, floor]));
  const spacesById = new Map(buildingPackage.spaces.map((space) => [space.id, space]));
  const poisById = new Map(buildingPackage.pois.map((poi) => [poi.id, poi]));
  const connectorsById = new Map(
    buildingPackage.verticalConnectors.map((connector) => [connector.id, connector]),
  );
  const categories = createCategoryStyles(buildingPackage.pois);

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
      icon: categories[poi.category]?.icon ?? 'P',
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

  const routingNodes: GraphNode[] = buildingPackage.routing.nodes.map((node) => {
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

  const routingEdges: GraphEdge[] = buildingPackage.routing.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    distance: edge.distanceMeters,
    corridor:
      edge.kind === 'vertical-connector'
        ? connectorsById.get(edge.sourceId)?.name
        : edge.spaceId
          ? spacesById.get(edge.spaceId)?.name
          : undefined,
    accessible: edge.accessible,
    restricted: edge.restricted,
    kind: edge.kind,
    connectorKind: edge.connectorKind,
    sourceId: edge.sourceId,
  }));

  const nodesById = new Map(routingNodes.map((node) => [node.id, node]));
  const visitorPois = routingNodes.filter((node): node is VisitorPoiNode => Boolean(node.poi));
  const getPOIs = (options: { includeRestricted?: boolean } = {}) =>
    options.includeRestricted ? [...visitorPois] : visitorPois.filter((node) => node.poi.public);
  const getDefaultStartNodeId = () => {
    const entryPoi = visitorPois.find(
      (node) => node.poi.spaceId === buildingPackage.building.entrySpaceId && node.poi.public,
    );
    if (!entryPoi) throw new Error('The compiled venue has no public POI in its entry space.');
    return entryPoi.id;
  };
  const defaultStartNode = getDefaultStartNodeId();

  return {
    key: `${buildingPackage.building.id}:${buildingPackage.manifest.contentHash}`,
    buildingPackage,
    routingNodes,
    routingEdges,
    config: createBuildingConfig(buildingPackage, defaultStartNode),
    categories,
    getCategory: (categoryId) => categories[categoryId] ?? categories.landmark,
    getPOIs,
    getNodeById: (id) => (id ? (nodesById.get(id) ?? null) : null),
    getPOIsByCategory: (category) => getPOIs().filter((node) => node.poi.category === category),
    getFloorById: (id) => floorsById.get(id) ?? null,
    getSpaceById: (id) => spacesById.get(id) ?? null,
    getDefaultStartNodeId,
  };
}
