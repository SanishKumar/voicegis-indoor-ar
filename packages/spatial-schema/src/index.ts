import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import buildingSourceSchema from '../schema/building-source.schema.json';

export const SPATIAL_SCHEMA_VERSION = '0.1.0' as const;

export type Coordinate2D = [number, number];
export type Coordinate3D = [number, number, number];
export type MeasurementUnit = 'meters';
export type SpaceType =
  'entrance' | 'room' | 'corridor' | 'lobby' | 'service' | 'restricted' | 'vertical-circulation';
export type PortalKind = 'door' | 'opening' | 'gate';
export type ConnectorKind = 'elevator' | 'stairs' | 'ramp' | 'escalator';
export type AnchorKind = 'qr' | 'apriltag' | 'image' | 'nfc';

export interface BuildingMetadata {
  id: string;
  name: string;
  units: MeasurementUnit;
  entrySpaceId: string;
  coordinateSystem: {
    type: 'local-cartesian';
    origin: Coordinate3D;
    northOffsetDegrees: number;
  };
}

export interface FloorSource {
  id: string;
  name: string;
  level: number;
  elevation: number;
  clearHeight: number;
  outline: Coordinate2D[];
}

export interface SpaceSource {
  id: string;
  floorId: string;
  name: string;
  type: SpaceType;
  polygon: Coordinate2D[];
  public: boolean;
  accessible: boolean;
}

export interface PortalSource {
  id: string;
  floorId: string;
  kind: PortalKind;
  connects: [string, string];
  position: Coordinate2D;
  width: number;
  accessible: boolean;
  restricted?: boolean;
}

export interface ConnectorStopSource {
  floorId: string;
  spaceId: string;
  position: Coordinate2D;
}

export interface VerticalConnectorSource {
  id: string;
  name: string;
  kind: ConnectorKind;
  accessible: boolean;
  restricted?: boolean;
  stops: ConnectorStopSource[];
}

export interface PoiSource {
  id: string;
  floorId: string;
  spaceId: string;
  name: string;
  category: string;
  position: Coordinate2D;
  public: boolean;
  accessible: boolean;
  aliases?: string[];
}

export interface LocalizationAnchorSource {
  id: string;
  floorId: string;
  spaceId: string;
  kind: AnchorKind;
  position: Coordinate2D;
  headingDegrees: number;
  payload: string;
}

export interface BuildingSource {
  schemaVersion: typeof SPATIAL_SCHEMA_VERSION;
  building: BuildingMetadata;
  floors: FloorSource[];
  spaces: SpaceSource[];
  portals: PortalSource[];
  verticalConnectors: VerticalConnectorSource[];
  pois: PoiSource[];
  localizationAnchors: LocalizationAnchorSource[];
}

export interface ShapeValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateShape = ajv.compile<BuildingSource>(buildingSourceSchema);

export function validateBuildingSourceShape(value: unknown): ShapeValidationResult {
  const valid = validateShape(value);
  return {
    valid,
    errors: valid ? [] : [...(validateShape.errors ?? [])],
  };
}

export function isBuildingSource(value: unknown): value is BuildingSource {
  return validateShape(value);
}

export function assertBuildingSourceShape(value: unknown): asserts value is BuildingSource {
  const result = validateBuildingSourceShape(value);
  if (result.valid) return;

  const details = result.errors
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
  throw new Error(`Building source does not match schema ${SPATIAL_SCHEMA_VERSION}: ${details}`);
}
