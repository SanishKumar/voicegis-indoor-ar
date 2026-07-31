import {
  SPATIAL_SCHEMA_VERSION,
  validateBuildingSourceShape,
  type AnchorKind,
  type BuildingSource,
  type ConnectorKind,
  type Coordinate2D,
  type Coordinate3D,
  type FloorSource,
  type LocalizationAnchorSource,
  type PoiSource,
  type PortalKind,
  type PortalSource,
  type SpaceSource,
  type SpaceType,
  type VerticalConnectorSource,
} from '@voicegis/spatial-schema';

export const DXF_IMPORT_PROFILE_VERSION = '0.1.0' as const;
export const DXF_LAYER_MAPPING_PROFILE_VERSION = '0.1.0' as const;

export type DxfImportIssueSeverity = 'error' | 'warning';

export interface DxfImportIssue {
  severity: DxfImportIssueSeverity;
  code: string;
  path: string;
  message: string;
}

export interface DxfImportOptions {
  fileName?: string;
  buildingId?: string;
  buildingName?: string;
  coordinateOrigin?: Coordinate3D;
  northOffsetDegrees?: number;
}

export interface DxfImportStats {
  parsedEntities: number;
  recognizedEntities: number;
  ignoredEntities: number;
  floors: number;
  spaces: number;
  portals: number;
  connectors: number;
  pois: number;
  anchors: number;
}

export interface DxfImportResult {
  valid: boolean;
  profileVersion: typeof DXF_IMPORT_PROFILE_VERSION;
  detectedUnits: string | null;
  source: BuildingSource | null;
  issues: DxfImportIssue[];
  stats: DxfImportStats;
}

export interface DxfLayerSummary {
  name: string;
  entityCount: number;
  entityTypes: string[];
  closedLightweightPolylines: number;
}

export interface DxfInspectionResult {
  valid: boolean;
  detectedUnits: string | null;
  layers: DxfLayerSummary[];
  issues: DxfImportIssue[];
}

export interface DxfLayerMapping {
  sourceLayer: string;
  targetLayer: string;
}

export interface DxfLayerMappingProfile {
  profileVersion: typeof DXF_LAYER_MAPPING_PROFILE_VERSION;
  mappings: DxfLayerMapping[];
}

export interface DxfLayerMappingApplication {
  valid: boolean;
  text: string | null;
  inspection: DxfInspectionResult;
  issues: DxfImportIssue[];
}

interface DxfPair {
  code: number;
  value: string;
  line: number;
}

interface DxfEntity {
  type: string;
  pairs: DxfPair[];
  index: number;
}

interface PolylineVertex {
  point: Coordinate2D;
  bulge: number;
}

interface UnitDefinition {
  name: string;
  metersPerUnit: number;
}

const UNIT_BY_INSUNITS = new Map<number, UnitDefinition>([
  [1, { name: 'inches', metersPerUnit: 0.0254 }],
  [2, { name: 'feet', metersPerUnit: 0.3048 }],
  [4, { name: 'millimeters', metersPerUnit: 0.001 }],
  [5, { name: 'centimeters', metersPerUnit: 0.01 }],
  [6, { name: 'meters', metersPerUnit: 1 }],
]);

const SPACE_TYPES = new Set<SpaceType>([
  'entrance',
  'room',
  'corridor',
  'lobby',
  'service',
  'restricted',
  'vertical-circulation',
]);
const PORTAL_KINDS = new Set<PortalKind>(['door', 'opening', 'gate']);
const CONNECTOR_KINDS = new Set<ConnectorKind>(['elevator', 'stairs', 'ramp', 'escalator']);
const ANCHOR_KINDS = new Set<AnchorKind>(['qr', 'apriltag', 'image', 'nfc']);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const ARC_STEP_RADIANS = Math.PI / 18;
const COORDINATE_PRECISION = 6;
const EPSILON = 1e-9;

function issue(
  issues: DxfImportIssue[],
  severity: DxfImportIssueSeverity,
  code: string,
  path: string,
  message: string,
) {
  issues.push({ severity, code, path, message });
}

function sortedIssues(issues: DxfImportIssue[]) {
  return [...issues].sort(
    (a, b) =>
      (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) ||
      a.code.localeCompare(b.code) ||
      a.path.localeCompare(b.path) ||
      a.message.localeCompare(b.message),
  );
}

function parsePairs(text: string, issues: DxfImportIssue[]) {
  if (text.startsWith('AutoCAD Binary DXF')) {
    issue(
      issues,
      'error',
      'binary-dxf-not-supported',
      '/',
      'DXF Importer v0 accepts ASCII DXF only. Export this drawing as ASCII DXF.',
    );
    return [];
  }

  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length % 2 !== 0) {
    issue(
      issues,
      'error',
      'malformed-group-pairs',
      '/',
      `ASCII DXF must contain code/value line pairs; found ${lines.length} lines.`,
    );
    return [];
  }

  const pairs: DxfPair[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const code = Number(lines[index].trim());
    if (!Number.isInteger(code)) {
      issue(
        issues,
        'error',
        'invalid-group-code',
        `/lines/${index + 1}`,
        `DXF group code "${lines[index]}" is not an integer.`,
      );
      continue;
    }
    pairs.push({ code, value: lines[index + 1].trim(), line: index + 1 });
  }
  return pairs;
}

function sectionPairs(pairs: DxfPair[], sectionName: string) {
  for (let index = 0; index < pairs.length - 1; index += 1) {
    if (
      pairs[index].code === 0 &&
      pairs[index].value.toUpperCase() === 'SECTION' &&
      pairs[index + 1].code === 2 &&
      pairs[index + 1].value.toUpperCase() === sectionName
    ) {
      const end = pairs.findIndex(
        (pair, pairIndex) =>
          pairIndex > index + 1 && pair.code === 0 && pair.value.toUpperCase() === 'ENDSEC',
      );
      return end < 0 ? null : pairs.slice(index + 2, end);
    }
  }
  return null;
}

function detectUnit(pairs: DxfPair[], issues: DxfImportIssue[]) {
  const header = sectionPairs(pairs, 'HEADER');
  const unitsMarker = header?.findIndex(
    (pair) => pair.code === 9 && pair.value.toUpperCase() === '$INSUNITS',
  );
  const unitsCodePair =
    unitsMarker === undefined || unitsMarker < 0
      ? undefined
      : header?.slice(unitsMarker + 1).find((pair) => pair.code === 70);
  const unitsCode = unitsCodePair ? Number(unitsCodePair.value) : Number.NaN;
  const unit = UNIT_BY_INSUNITS.get(unitsCode) ?? null;
  if (!unit) {
    issue(
      issues,
      'error',
      'unsupported-or-missing-units',
      '/header/$INSUNITS',
      'Declare $INSUNITS as inches, feet, millimeters, centimeters, or meters.',
    );
  }
  return unit;
}

function parseEntities(pairs: DxfPair[], issues: DxfImportIssue[]) {
  const contents = sectionPairs(pairs, 'ENTITIES');
  if (!contents) {
    issue(
      issues,
      'error',
      'missing-entities-section',
      '/',
      'DXF has no complete ENTITIES section.',
    );
    return [];
  }

  const entities: DxfEntity[] = [];
  let current: DxfEntity | null = null;
  for (const pair of contents) {
    if (pair.code === 0) {
      if (current) entities.push(current);
      current = { type: pair.value.toUpperCase(), pairs: [], index: entities.length };
    } else if (current) {
      current.pairs.push(pair);
    }
  }
  if (current) entities.push(current);
  return entities;
}

function firstValue(entity: DxfEntity, code: number) {
  return entity.pairs.find((pair) => pair.code === code)?.value;
}

function numericValue(
  value: string | undefined,
  issues: DxfImportIssue[],
  path: string,
  label: string,
) {
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) {
    issue(issues, 'error', 'invalid-number', path, `${label} must be a finite number.`);
    return null;
  }
  return parsed;
}

function integerValue(
  value: string | undefined,
  issues: DxfImportIssue[],
  path: string,
  label: string,
) {
  const parsed = numericValue(value, issues, path, label);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) {
    issue(issues, 'error', 'invalid-integer', path, `${label} must be an integer.`);
    return null;
  }
  return parsed;
}

function booleanValue(
  value: string | undefined,
  issues: DxfImportIssue[],
  path: string,
  label: string,
) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  issue(
    issues,
    'error',
    'missing-explicit-policy',
    path,
    `${label} must be explicitly "true" or "false".`,
  );
  return null;
}

function decodedValue(
  value: string | undefined,
  issues: DxfImportIssue[],
  path: string,
  label: string,
) {
  if (!value) {
    issue(issues, 'error', 'missing-layer-field', path, `${label} is required.`);
    return null;
  }
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.trim().length === 0) throw new Error('empty');
    return decoded;
  } catch {
    issue(
      issues,
      'error',
      'invalid-layer-field',
      path,
      `${label} must be non-empty and use valid percent encoding.`,
    );
    return null;
  }
}

function idValue(value: string | undefined, issues: DxfImportIssue[], path: string, label: string) {
  const decoded = decodedValue(value, issues, path, label);
  if (decoded === null) return null;
  if (!ID_PATTERN.test(decoded) || decoded.length > 96) {
    issue(
      issues,
      'error',
      'invalid-id',
      path,
      `${label} must match ${ID_PATTERN.source} and be no longer than 96 characters.`,
    );
    return null;
  }
  return decoded;
}

function roundCoordinate(value: number) {
  const rounded = Number(value.toFixed(COORDINATE_PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function samePoint(a: Coordinate2D, b: Coordinate2D) {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

function signedPolygonArea(points: Coordinate2D[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function expandBulges(vertices: PolylineVertex[]) {
  const result: Coordinate2D[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    result.push(start.point);
    if (Math.abs(start.bulge) <= EPSILON) continue;

    const dx = end.point[0] - start.point[0];
    const dy = end.point[1] - start.point[1];
    const chord = Math.hypot(dx, dy);
    if (chord <= EPSILON) continue;
    const theta = 4 * Math.atan(start.bulge);
    const midpoint: Coordinate2D = [
      (start.point[0] + end.point[0]) / 2,
      (start.point[1] + end.point[1]) / 2,
    ];
    const centreOffset = (chord * (1 - start.bulge * start.bulge)) / (4 * start.bulge);
    const centre: Coordinate2D = [
      midpoint[0] + (-dy / chord) * centreOffset,
      midpoint[1] + (dx / chord) * centreOffset,
    ];
    const radius = Math.hypot(start.point[0] - centre[0], start.point[1] - centre[1]);
    const startAngle = Math.atan2(start.point[1] - centre[1], start.point[0] - centre[0]);
    const steps = Math.max(1, Math.ceil(Math.abs(theta) / ARC_STEP_RADIANS));
    for (let step = 1; step < steps; step += 1) {
      const angle = startAngle + (theta * step) / steps;
      result.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
    }
  }
  return result;
}

function canonicalPolygon(points: Coordinate2D[]) {
  const deduplicated = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1]),
  );
  if (deduplicated.length > 1 && samePoint(deduplicated[0], deduplicated.at(-1)!)) {
    deduplicated.pop();
  }
  const oriented = signedPolygonArea(deduplicated) < 0 ? [...deduplicated].reverse() : deduplicated;
  let firstIndex = 0;
  for (let index = 1; index < oriented.length; index += 1) {
    const current = oriented[index];
    const first = oriented[firstIndex];
    if (current[0] < first[0] || (current[0] === first[0] && current[1] < first[1])) {
      firstIndex = index;
    }
  }
  return [...oriented.slice(firstIndex), ...oriented.slice(0, firstIndex)].map(
    ([x, y]) => [roundCoordinate(x), roundCoordinate(y)] as Coordinate2D,
  );
}

function assertPlanarEntity(entity: DxfEntity, issues: DxfImportIssue[], path: string) {
  const nonZeroZ = entity.pairs.some(
    (pair) => [30, 31, 32, 33, 38].includes(pair.code) && Math.abs(Number(pair.value)) > EPSILON,
  );
  if (nonZeroZ) {
    issue(
      issues,
      'error',
      'non-planar-entity',
      path,
      'DXF Importer v0 accepts 2D entities at Z=0 only.',
    );
    return false;
  }
  const paperSpace = Number(firstValue(entity, 67) ?? 0) === 1;
  if (paperSpace) {
    issue(
      issues,
      'error',
      'paper-space-entity',
      path,
      'VoiceGIS semantic entities must be in model space.',
    );
    return false;
  }
  return true;
}

function parsePolyline(entity: DxfEntity, scale: number, issues: DxfImportIssue[], path: string) {
  const flags = Number(firstValue(entity, 70) ?? 0);
  if ((flags & 1) !== 1) {
    issue(issues, 'error', 'open-polyline', path, 'Floor and space polylines must be closed.');
    return null;
  }

  const vertices: PolylineVertex[] = [];
  let current: { x: number; y?: number; bulge: number } | null = null;
  for (const pair of entity.pairs) {
    if (pair.code === 10) {
      if (current?.y !== undefined) {
        vertices.push({
          point: [current.x * scale, current.y * scale],
          bulge: current.bulge,
        });
      }
      current = { x: Number(pair.value), bulge: 0 };
    } else if (pair.code === 20 && current) {
      current.y = Number(pair.value);
    } else if (pair.code === 42 && current) {
      current.bulge = Number(pair.value);
    }
  }
  if (current?.y !== undefined) {
    vertices.push({ point: [current.x * scale, current.y * scale], bulge: current.bulge });
  }
  if (
    vertices.length < 3 ||
    vertices.some(({ point, bulge }) => [...point, bulge].some((value) => !Number.isFinite(value)))
  ) {
    issue(
      issues,
      'error',
      'invalid-polyline',
      path,
      'Closed LWPOLYLINE must contain at least three finite XY vertices.',
    );
    return null;
  }
  const polygon = canonicalPolygon(expandBulges(vertices));
  if (polygon.length < 3 || Math.abs(signedPolygonArea(polygon)) < 0.01) {
    issue(issues, 'error', 'degenerate-polygon', path, 'Imported polygon has no usable area.');
    return null;
  }
  return polygon;
}

function parsePoint(entity: DxfEntity, scale: number, issues: DxfImportIssue[], path: string) {
  const x = numericValue(firstValue(entity, 10), issues, `${path}/x`, 'Point X');
  const y = numericValue(firstValue(entity, 20), issues, `${path}/y`, 'Point Y');
  if (x === null || y === null) return null;
  return [roundCoordinate(x * scale), roundCoordinate(y * scale)] as Coordinate2D;
}

function parseLine(entity: DxfEntity, scale: number, issues: DxfImportIssue[], path: string) {
  const x1 = numericValue(firstValue(entity, 10), issues, `${path}/x1`, 'Line start X');
  const y1 = numericValue(firstValue(entity, 20), issues, `${path}/y1`, 'Line start Y');
  const x2 = numericValue(firstValue(entity, 11), issues, `${path}/x2`, 'Line end X');
  const y2 = numericValue(firstValue(entity, 21), issues, `${path}/y2`, 'Line end Y');
  if ([x1, y1, x2, y2].some((value) => value === null)) return null;
  const start: Coordinate2D = [x1! * scale, y1! * scale];
  const end: Coordinate2D = [x2! * scale, y2! * scale];
  const width = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (width <= EPSILON) {
    issue(issues, 'error', 'zero-width-portal', path, 'Portal line must have a non-zero length.');
    return null;
  }
  return {
    position: [
      roundCoordinate((start[0] + end[0]) / 2),
      roundCoordinate((start[1] + end[1]) / 2),
    ] as Coordinate2D,
    width: roundCoordinate(width),
  };
}

function inferredBuildingId(fileName: string | undefined) {
  const base = (fileName ?? 'imported-venue').replace(/\.dxf$/i, '').toLowerCase();
  const normalized = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 96);
  return normalized || 'imported-venue';
}

function displayNameFromId(id: string) {
  return id
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function emptyStats(): DxfImportStats {
  return {
    parsedEntities: 0,
    recognizedEntities: 0,
    ignoredEntities: 0,
    floors: 0,
    spaces: 0,
    portals: 0,
    connectors: 0,
    pois: 0,
    anchors: 0,
  };
}

/**
 * Deterministically imports the explicit VoiceGIS DXF v0 layer profile.
 * It never infers accessibility, room semantics, connectivity, or units.
 */
export function importAnnotatedDxf(text: string, options: DxfImportOptions = {}): DxfImportResult {
  const issues: DxfImportIssue[] = [];
  const stats = emptyStats();
  const pairs = parsePairs(text, issues);
  const unit = detectUnit(pairs, issues);

  const entities = parseEntities(pairs, issues);
  stats.parsedEntities = entities.length;
  const floors: FloorSource[] = [];
  const spaces: SpaceSource[] = [];
  const portals: PortalSource[] = [];
  const connectorById = new Map<string, VerticalConnectorSource>();
  const pois: PoiSource[] = [];
  const localizationAnchors: LocalizationAnchorSource[] = [];
  const scale = unit?.metersPerUnit ?? 1;

  for (const entity of entities) {
    const layer = firstValue(entity, 8) ?? '';
    const path = `/entities/${entity.index}`;
    if (!layer.startsWith('VG$')) {
      stats.ignoredEntities += 1;
      continue;
    }
    stats.recognizedEntities += 1;
    if (!assertPlanarEntity(entity, issues, path)) continue;

    const parts = layer.split('$');
    const kind = parts[1];
    if (kind === 'FLOOR') {
      if (entity.type !== 'LWPOLYLINE' || parts.length !== 7) {
        issue(
          issues,
          'error',
          'invalid-floor-entity',
          `${path}/layer`,
          'FLOOR requires one closed LWPOLYLINE on VG$FLOOR$id$level$elevation$clearHeight$name.',
        );
        continue;
      }
      const id = idValue(parts[2], issues, `${path}/layer/id`, 'Floor id');
      const level = integerValue(parts[3], issues, `${path}/layer/level`, 'Floor level');
      const elevation = numericValue(
        parts[4],
        issues,
        `${path}/layer/elevation`,
        'Floor elevation',
      );
      const clearHeight = numericValue(
        parts[5],
        issues,
        `${path}/layer/clearHeight`,
        'Floor clear height',
      );
      const name = decodedValue(parts[6], issues, `${path}/layer/name`, 'Floor name');
      const outline = parsePolyline(entity, scale, issues, path);
      if (
        id === null ||
        level === null ||
        elevation === null ||
        clearHeight === null ||
        name === null ||
        !outline
      ) {
        continue;
      }
      floors.push({
        id,
        name,
        level,
        elevation: roundCoordinate(elevation * scale),
        clearHeight: roundCoordinate(clearHeight * scale),
        outline,
      });
      continue;
    }

    if (kind === 'SPACE') {
      if (entity.type !== 'LWPOLYLINE' || parts.length !== 8) {
        issue(
          issues,
          'error',
          'invalid-space-entity',
          `${path}/layer`,
          'SPACE requires one closed LWPOLYLINE on VG$SPACE$floorId$id$type$public$accessible$name.',
        );
        continue;
      }
      const floorId = idValue(parts[2], issues, `${path}/layer/floorId`, 'Space floor id');
      const id = idValue(parts[3], issues, `${path}/layer/id`, 'Space id');
      const type = parts[4] as SpaceType;
      if (!SPACE_TYPES.has(type)) {
        issue(issues, 'error', 'invalid-space-type', `${path}/layer/type`, 'Unknown space type.');
      }
      const isPublic = booleanValue(parts[5], issues, `${path}/layer/public`, 'Space public');
      const accessible = booleanValue(
        parts[6],
        issues,
        `${path}/layer/accessible`,
        'Space accessible',
      );
      const name = decodedValue(parts[7], issues, `${path}/layer/name`, 'Space name');
      const polygon = parsePolyline(entity, scale, issues, path);
      if (
        floorId === null ||
        id === null ||
        !SPACE_TYPES.has(type) ||
        isPublic === null ||
        accessible === null ||
        name === null ||
        !polygon
      ) {
        continue;
      }
      spaces.push({ id, floorId, name, type, polygon, public: isPublic, accessible });
      continue;
    }

    if (kind === 'PORTAL') {
      if (entity.type !== 'LINE' || parts.length !== 9) {
        issue(
          issues,
          'error',
          'invalid-portal-entity',
          `${path}/layer`,
          'PORTAL requires one LINE on VG$PORTAL$floorId$id$kind$spaceA$spaceB$accessible$restricted.',
        );
        continue;
      }
      const floorId = idValue(parts[2], issues, `${path}/layer/floorId`, 'Portal floor id');
      const id = idValue(parts[3], issues, `${path}/layer/id`, 'Portal id');
      const portalKind = parts[4] as PortalKind;
      if (!PORTAL_KINDS.has(portalKind)) {
        issue(issues, 'error', 'invalid-portal-kind', `${path}/layer/kind`, 'Unknown portal kind.');
      }
      const spaceA = idValue(parts[5], issues, `${path}/layer/spaceA`, 'First connected space');
      const spaceB = idValue(parts[6], issues, `${path}/layer/spaceB`, 'Second connected space');
      const accessible = booleanValue(
        parts[7],
        issues,
        `${path}/layer/accessible`,
        'Portal accessible',
      );
      const restricted = booleanValue(
        parts[8],
        issues,
        `${path}/layer/restricted`,
        'Portal restricted',
      );
      const line = parseLine(entity, scale, issues, path);
      if (
        floorId === null ||
        id === null ||
        !PORTAL_KINDS.has(portalKind) ||
        spaceA === null ||
        spaceB === null ||
        accessible === null ||
        restricted === null ||
        !line
      ) {
        continue;
      }
      portals.push({
        id,
        floorId,
        kind: portalKind,
        connects: [spaceA, spaceB].sort((a, b) => a.localeCompare(b)) as [string, string],
        position: line.position,
        width: line.width,
        accessible,
        restricted,
      });
      continue;
    }

    if (kind === 'CONNECTOR') {
      if (entity.type !== 'POINT' || parts.length !== 9) {
        issue(
          issues,
          'error',
          'invalid-connector-entity',
          `${path}/layer`,
          'CONNECTOR stop requires one POINT on VG$CONNECTOR$id$kind$accessible$restricted$floorId$spaceId$name.',
        );
        continue;
      }
      const id = idValue(parts[2], issues, `${path}/layer/id`, 'Connector id');
      const connectorKind = parts[3] as ConnectorKind;
      if (!CONNECTOR_KINDS.has(connectorKind)) {
        issue(
          issues,
          'error',
          'invalid-connector-kind',
          `${path}/layer/kind`,
          'Unknown connector kind.',
        );
      }
      const accessible = booleanValue(
        parts[4],
        issues,
        `${path}/layer/accessible`,
        'Connector accessible',
      );
      const restricted = booleanValue(
        parts[5],
        issues,
        `${path}/layer/restricted`,
        'Connector restricted',
      );
      const floorId = idValue(parts[6], issues, `${path}/layer/floorId`, 'Connector floor id');
      const spaceId = idValue(parts[7], issues, `${path}/layer/spaceId`, 'Connector space id');
      const name = decodedValue(parts[8], issues, `${path}/layer/name`, 'Connector name');
      const position = parsePoint(entity, scale, issues, path);
      if (
        id === null ||
        !CONNECTOR_KINDS.has(connectorKind) ||
        accessible === null ||
        restricted === null ||
        floorId === null ||
        spaceId === null ||
        name === null ||
        !position
      ) {
        continue;
      }
      const existing = connectorById.get(id);
      if (
        existing &&
        (existing.kind !== connectorKind ||
          existing.accessible !== accessible ||
          existing.restricted !== restricted ||
          existing.name !== name)
      ) {
        issue(
          issues,
          'error',
          'inconsistent-connector-metadata',
          `${path}/layer`,
          `Every stop for connector "${id}" must use identical metadata.`,
        );
        continue;
      }
      const connector =
        existing ??
        ({
          id,
          name,
          kind: connectorKind,
          accessible,
          restricted,
          stops: [],
        } satisfies VerticalConnectorSource);
      connector.stops.push({ floorId, spaceId, position });
      connectorById.set(id, connector);
      continue;
    }

    if (kind === 'POI') {
      if (entity.type !== 'POINT' || parts.length !== 9) {
        issue(
          issues,
          'error',
          'invalid-poi-entity',
          `${path}/layer`,
          'POI requires one POINT on VG$POI$floorId$spaceId$id$category$public$accessible$name.',
        );
        continue;
      }
      const floorId = idValue(parts[2], issues, `${path}/layer/floorId`, 'POI floor id');
      const spaceId = idValue(parts[3], issues, `${path}/layer/spaceId`, 'POI space id');
      const id = idValue(parts[4], issues, `${path}/layer/id`, 'POI id');
      const category = decodedValue(parts[5], issues, `${path}/layer/category`, 'POI category');
      const isPublic = booleanValue(parts[6], issues, `${path}/layer/public`, 'POI public');
      const accessible = booleanValue(
        parts[7],
        issues,
        `${path}/layer/accessible`,
        'POI accessible',
      );
      const name = decodedValue(parts[8], issues, `${path}/layer/name`, 'POI name');
      const position = parsePoint(entity, scale, issues, path);
      if (
        floorId === null ||
        spaceId === null ||
        id === null ||
        category === null ||
        isPublic === null ||
        accessible === null ||
        name === null ||
        !position
      ) {
        continue;
      }
      pois.push({
        id,
        floorId,
        spaceId,
        name,
        category,
        position,
        public: isPublic,
        accessible,
      });
      continue;
    }

    if (kind === 'ANCHOR') {
      if (entity.type !== 'POINT' || parts.length !== 8) {
        issue(
          issues,
          'error',
          'invalid-anchor-entity',
          `${path}/layer`,
          'ANCHOR requires one POINT on VG$ANCHOR$floorId$spaceId$id$kind$headingDegrees$payload.',
        );
        continue;
      }
      const floorId = idValue(parts[2], issues, `${path}/layer/floorId`, 'Anchor floor id');
      const spaceId = idValue(parts[3], issues, `${path}/layer/spaceId`, 'Anchor space id');
      const id = idValue(parts[4], issues, `${path}/layer/id`, 'Anchor id');
      const anchorKind = parts[5] as AnchorKind;
      if (!ANCHOR_KINDS.has(anchorKind)) {
        issue(issues, 'error', 'invalid-anchor-kind', `${path}/layer/kind`, 'Unknown anchor kind.');
      }
      const headingDegrees = numericValue(
        parts[6],
        issues,
        `${path}/layer/headingDegrees`,
        'Anchor heading',
      );
      const payload = decodedValue(parts[7], issues, `${path}/layer/payload`, 'Anchor payload');
      const position = parsePoint(entity, scale, issues, path);
      if (
        floorId === null ||
        spaceId === null ||
        id === null ||
        !ANCHOR_KINDS.has(anchorKind) ||
        headingDegrees === null ||
        payload === null ||
        !position
      ) {
        continue;
      }
      localizationAnchors.push({
        id,
        floorId,
        spaceId,
        kind: anchorKind,
        position,
        headingDegrees,
        payload,
      });
      continue;
    }

    issue(
      issues,
      'error',
      'unknown-voicegis-layer-kind',
      `${path}/layer`,
      `VoiceGIS layer kind "${kind ?? ''}" is not supported by profile ${DXF_IMPORT_PROFILE_VERSION}.`,
    );
  }

  if (stats.ignoredEntities > 0) {
    issue(
      issues,
      'warning',
      'ignored-unannotated-entities',
      '/entities',
      `${stats.ignoredEntities} unannotated DXF entities were ignored.`,
    );
  }
  if (stats.recognizedEntities === 0) {
    issue(
      issues,
      'error',
      'no-voicegis-entities',
      '/entities',
      'No entities use the explicit VG$... DXF layer profile.',
    );
  }

  const verticalConnectors = [...connectorById.values()];
  const floorLevelById = new Map(floors.map((floor) => [floor.id, floor.level]));
  verticalConnectors.forEach((connector) =>
    connector.stops.sort(
      (a, b) =>
        (floorLevelById.get(a.floorId) ?? 0) - (floorLevelById.get(b.floorId) ?? 0) ||
        a.floorId.localeCompare(b.floorId) ||
        a.spaceId.localeCompare(b.spaceId),
    ),
  );
  floors.sort((a, b) => a.id.localeCompare(b.id));
  spaces.sort((a, b) => a.id.localeCompare(b.id));
  portals.sort((a, b) => a.id.localeCompare(b.id));
  verticalConnectors.sort((a, b) => a.id.localeCompare(b.id));
  pois.sort((a, b) => a.id.localeCompare(b.id));
  localizationAnchors.sort((a, b) => a.id.localeCompare(b.id));

  stats.floors = floors.length;
  stats.spaces = spaces.length;
  stats.portals = portals.length;
  stats.connectors = verticalConnectors.length;
  stats.pois = pois.length;
  stats.anchors = localizationAnchors.length;

  const buildingId = options.buildingId ?? inferredBuildingId(options.fileName);
  if (!ID_PATTERN.test(buildingId) || buildingId.length > 96) {
    issue(issues, 'error', 'invalid-building-id', '/building/id', 'Building id is invalid.');
  }
  const buildingName = options.buildingName?.trim() || displayNameFromId(buildingId);
  const entryCandidates = spaces.filter((space) => space.type === 'entrance' && space.public);
  if (entryCandidates.length !== 1) {
    issue(
      issues,
      'error',
      'ambiguous-entry-space',
      '/building/entrySpaceId',
      `Exactly one public entrance space is required; found ${entryCandidates.length}.`,
    );
  }
  const northOffsetDegrees = options.northOffsetDegrees ?? 0;
  if (
    !Number.isFinite(northOffsetDegrees) ||
    northOffsetDegrees < -180 ||
    northOffsetDegrees >= 180
  ) {
    issue(
      issues,
      'error',
      'invalid-north-offset',
      '/building/coordinateSystem/northOffsetDegrees',
      'North offset must be at least -180 and less than 180 degrees.',
    );
  }

  let source: BuildingSource | null = null;
  if (!issues.some((entry) => entry.severity === 'error') && unit) {
    const candidate: BuildingSource = {
      schemaVersion: SPATIAL_SCHEMA_VERSION,
      building: {
        id: buildingId,
        name: buildingName,
        units: 'meters',
        entrySpaceId: entryCandidates[0].id,
        coordinateSystem: {
          type: 'local-cartesian',
          origin: options.coordinateOrigin ?? [0, 0, 0],
          northOffsetDegrees,
        },
      },
      floors,
      spaces,
      portals,
      verticalConnectors,
      pois,
      localizationAnchors,
    };
    const shape = validateBuildingSourceShape(candidate);
    if (shape.valid) {
      source = candidate;
    } else {
      shape.errors.forEach((error) =>
        issue(
          issues,
          'error',
          `source-schema-${error.keyword}`,
          error.instancePath || '/',
          error.message ?? 'Imported source does not match the BuildingSource schema.',
        ),
      );
    }
  }

  const finalIssues = sortedIssues(issues);
  return {
    valid: source !== null && finalIssues.every((entry) => entry.severity !== 'error'),
    profileVersion: DXF_IMPORT_PROFILE_VERSION,
    detectedUnits: unit?.name ?? null,
    source,
    issues: finalIssues,
    stats,
  };
}

/** Reads DXF structure without assigning any venue semantics. */
export function inspectDxfLayers(text: string): DxfInspectionResult {
  const issues: DxfImportIssue[] = [];
  const pairs = parsePairs(text, issues);
  const unit = detectUnit(pairs, issues);
  const entities = parseEntities(pairs, issues);
  const layerState = new Map<
    string,
    { entityCount: number; entityTypes: Set<string>; closedLightweightPolylines: number }
  >();

  for (const entity of entities) {
    const layer = firstValue(entity, 8);
    if (!layer) {
      issue(
        issues,
        'warning',
        'unlayered-entity',
        `/entities/${entity.index}`,
        `Entity ${entity.index} has no layer and cannot be mapped.`,
      );
      continue;
    }
    const current = layerState.get(layer) ?? {
      entityCount: 0,
      entityTypes: new Set<string>(),
      closedLightweightPolylines: 0,
    };
    current.entityCount += 1;
    current.entityTypes.add(entity.type);
    if (entity.type === 'LWPOLYLINE' && (Number(firstValue(entity, 70) ?? 0) & 1) === 1) {
      current.closedLightweightPolylines += 1;
    }
    layerState.set(layer, current);
  }

  const layers = [...layerState.entries()]
    .map(([name, state]) => ({
      name,
      entityCount: state.entityCount,
      entityTypes: [...state.entityTypes].sort((a, b) => a.localeCompare(b)),
      closedLightweightPolylines: state.closedLightweightPolylines,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (layers.length === 0) {
    issue(issues, 'error', 'no-mappable-layers', '/entities', 'DXF contains no named layers.');
  }

  const finalIssues = sortedIssues(issues);
  return {
    valid: finalIssues.every((entry) => entry.severity !== 'error'),
    detectedUnits: unit?.name ?? null,
    layers,
    issues: finalIssues,
  };
}

/**
 * Applies an explicit floor/space layer profile without interpreting layer
 * names. Later slices can add more roles while preserving this profile boundary.
 */
export function applyDxfLayerMapping(
  text: string,
  profile: DxfLayerMappingProfile,
): DxfLayerMappingApplication {
  const inspection = inspectDxfLayers(text);
  const issues = [...inspection.issues];
  if (profile.profileVersion !== DXF_LAYER_MAPPING_PROFILE_VERSION) {
    issue(
      issues,
      'error',
      'unsupported-mapping-profile',
      '/profileVersion',
      `Expected DXF layer mapping profile ${DXF_LAYER_MAPPING_PROFILE_VERSION}.`,
    );
  }
  if (profile.mappings.length === 0) {
    issue(issues, 'error', 'empty-layer-mapping', '/mappings', 'Map at least one DXF layer.');
  }

  const layerByName = new Map(inspection.layers.map((layer) => [layer.name, layer]));
  const seenSources = new Set<string>();
  const seenTargets = new Set<string>();
  const mappingBySource = new Map<string, string>();
  for (const [index, mapping] of profile.mappings.entries()) {
    const path = `/mappings/${index}`;
    if (seenSources.has(mapping.sourceLayer)) {
      issue(
        issues,
        'error',
        'duplicate-source-layer',
        `${path}/sourceLayer`,
        `Layer "${mapping.sourceLayer}" is mapped more than once.`,
      );
    }
    if (seenTargets.has(mapping.targetLayer)) {
      issue(
        issues,
        'error',
        'duplicate-target-layer',
        `${path}/targetLayer`,
        'Every floor or space must have its own semantic target layer.',
      );
    }
    seenSources.add(mapping.sourceLayer);
    seenTargets.add(mapping.targetLayer);

    const layer = layerByName.get(mapping.sourceLayer);
    if (!layer) {
      issue(
        issues,
        'error',
        'unknown-source-layer',
        `${path}/sourceLayer`,
        `DXF layer "${mapping.sourceLayer}" does not exist.`,
      );
      continue;
    }
    if (
      !mapping.targetLayer.startsWith('VG$FLOOR$') &&
      !mapping.targetLayer.startsWith('VG$SPACE$')
    ) {
      issue(
        issues,
        'error',
        'unsupported-mapping-role',
        `${path}/targetLayer`,
        'CAD Mapping Workspace v0 Slice 1 supports floor and space targets only.',
      );
    }
    if (
      layer.entityCount !== 1 ||
      layer.closedLightweightPolylines !== 1 ||
      layer.entityTypes.length !== 1 ||
      layer.entityTypes[0] !== 'LWPOLYLINE'
    ) {
      issue(
        issues,
        'error',
        'layer-not-single-closed-polyline',
        `${path}/sourceLayer`,
        `Layer "${mapping.sourceLayer}" must contain exactly one closed LWPOLYLINE in this slice.`,
      );
    }
    mappingBySource.set(mapping.sourceLayer, mapping.targetLayer);
  }

  const finalIssues = sortedIssues(issues);
  if (finalIssues.some((entry) => entry.severity === 'error')) {
    return { valid: false, text: null, inspection, issues: finalIssues };
  }

  const parseIssues: DxfImportIssue[] = [];
  const pairs = parsePairs(text, parseIssues);
  const mappedText = `${pairs
    .map((pair) => {
      const value = pair.code === 8 ? (mappingBySource.get(pair.value) ?? pair.value) : pair.value;
      return `${pair.code}\n${value}`;
    })
    .join('\n')}\n`;
  const outputIssues = sortedIssues([...finalIssues, ...parseIssues]);
  return {
    valid: outputIssues.every((entry) => entry.severity !== 'error'),
    text: outputIssues.some((entry) => entry.severity === 'error') ? null : mappedText,
    inspection,
    issues: outputIssues,
  };
}
