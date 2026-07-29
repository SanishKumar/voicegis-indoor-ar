import { validateBuildingSourceShape, type BuildingSource } from '@voicegis/spatial-schema';
import { validateBuildingSemantics, type ValidationIssue } from '@voicegis/map-compiler/validation';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';

export type StudioValidationStage = 'json' | 'schema' | 'semantic';

export interface StudioValidationIssue extends ValidationIssue {
  stage: StudioValidationStage;
}

export interface BuildingSourceStats {
  floors: number;
  spaces: number;
  portals: number;
  connectors: number;
  pois: number;
  anchors: number;
}

export interface BuildingSourceDraftValidation {
  valid: boolean;
  syntaxValid: boolean;
  shapeValid: boolean;
  source: BuildingSource | null;
  issues: StudioValidationIssue[];
  stats: BuildingSourceStats | null;
}

function shapeIssuePath(instancePath: string, keyword: string, params: Record<string, unknown>) {
  if (keyword !== 'required' || typeof params.missingProperty !== 'string') {
    return instancePath || '/';
  }
  return `${instancePath}/${params.missingProperty}`.replace('//', '/');
}

export function sourceFromVenuePackage(buildingPackage: CompiledBuildingPackage): BuildingSource {
  return {
    schemaVersion: buildingPackage.sourceSchemaVersion,
    building: structuredClone(buildingPackage.building),
    floors: structuredClone(buildingPackage.floors),
    spaces: structuredClone(buildingPackage.spaces),
    portals: structuredClone(buildingPackage.portals),
    verticalConnectors: structuredClone(buildingPackage.verticalConnectors),
    pois: structuredClone(buildingPackage.pois),
    localizationAnchors: structuredClone(buildingPackage.localizationAnchors),
  };
}

export function formatBuildingSource(source: BuildingSource) {
  return `${JSON.stringify(source, null, 2)}\n`;
}

export function summarizeBuildingSource(source: BuildingSource): BuildingSourceStats {
  return {
    floors: source.floors.length,
    spaces: source.spaces.length,
    portals: source.portals.length,
    connectors: source.verticalConnectors.length,
    pois: source.pois.length,
    anchors: source.localizationAnchors.length,
  };
}

export function validateBuildingSourceDraft(text: string): BuildingSourceDraftValidation {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      valid: false,
      syntaxValid: false,
      shapeValid: false,
      source: null,
      stats: null,
      issues: [
        {
          stage: 'json',
          severity: 'error',
          code: 'invalid-json',
          path: '/',
          message: error instanceof Error ? error.message : 'The draft is not valid JSON.',
        },
      ],
    };
  }

  const shape = validateBuildingSourceShape(value);
  if (!shape.valid) {
    return {
      valid: false,
      syntaxValid: true,
      shapeValid: false,
      source: null,
      stats: null,
      issues: shape.errors.map((error) => ({
        stage: 'schema',
        severity: 'error',
        code: `schema-${error.keyword}`,
        path: shapeIssuePath(error.instancePath, error.keyword, error.params),
        message: error.message ?? 'Value does not match the BuildingSource schema.',
      })),
    };
  }

  const source = value as BuildingSource;
  const semanticIssues: StudioValidationIssue[] = validateBuildingSemantics(source).map(
    (issue) => ({
      ...issue,
      stage: 'semantic',
    }),
  );
  return {
    valid: semanticIssues.every((issue) => issue.severity !== 'error'),
    syntaxValid: true,
    shapeValid: true,
    source,
    issues: semanticIssues,
    stats: summarizeBuildingSource(source),
  };
}
