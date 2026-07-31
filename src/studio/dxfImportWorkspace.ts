import {
  applyDxfLayerMapping,
  importAnnotatedDxf,
  type DxfImportIssue,
  type DxfImportResult,
  type DxfImportStats,
  type DxfLayerMappingProfile,
} from '@voicegis/dxf-importer';
import { formatBuildingSource, validateBuildingSourceDraft } from './buildingSourceWorkspace';

export interface StudioDxfImportIssue extends DxfImportIssue {
  stage: 'dxf' | 'schema' | 'semantic';
}

export interface StudioDxfImportReport {
  accepted: boolean;
  fileName: string;
  detectedUnits: string | null;
  issues: StudioDxfImportIssue[];
  stats: DxfImportStats;
}

export interface StudioDxfImportOutcome {
  draftText: string;
  draftName: string | null;
  report: StudioDxfImportReport;
}

function emptyImportStats(parsedEntities = 0): DxfImportStats {
  return {
    parsedEntities,
    recognizedEntities: 0,
    ignoredEntities: parsedEntities,
    floors: 0,
    spaces: 0,
    portals: 0,
    connectors: 0,
    pois: 0,
    anchors: 0,
  };
}

function stageImportedResult(
  imported: DxfImportResult,
  fileName: string,
  currentDraftText: string,
  preparationIssues: DxfImportIssue[] = [],
): StudioDxfImportOutcome {
  const uniqueIssues = new Map<string, StudioDxfImportIssue>();
  [...preparationIssues, ...imported.issues].forEach((entry) => {
    uniqueIssues.set(`${entry.severity}:${entry.code}:${entry.path}:${entry.message}`, {
      ...entry,
      stage: 'dxf',
    });
  });
  const dxfIssues = [...uniqueIssues.values()];

  if (!imported.source) {
    return {
      draftText: currentDraftText,
      draftName: null,
      report: {
        accepted: false,
        fileName,
        detectedUnits: imported.detectedUnits,
        issues: dxfIssues,
        stats: imported.stats,
      },
    };
  }

  const candidateText = formatBuildingSource(imported.source);
  const validation = validateBuildingSourceDraft(candidateText);
  const validationIssues: StudioDxfImportIssue[] = validation.issues.map((entry) => ({
    severity: entry.severity,
    code: entry.code,
    path: entry.path,
    message: entry.message,
    stage: entry.stage === 'json' ? 'schema' : entry.stage,
  }));
  const issues = [...dxfIssues, ...validationIssues].sort(
    (a, b) =>
      (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) ||
      a.stage.localeCompare(b.stage) ||
      a.code.localeCompare(b.code) ||
      a.path.localeCompare(b.path),
  );
  if (!validation.valid) {
    return {
      draftText: currentDraftText,
      draftName: null,
      report: {
        accepted: false,
        fileName,
        detectedUnits: imported.detectedUnits,
        issues,
        stats: imported.stats,
      },
    };
  }

  return {
    draftText: candidateText,
    draftName: `${imported.source.building.id}.json`,
    report: {
      accepted: true,
      fileName,
      detectedUnits: imported.detectedUnits,
      issues,
      stats: imported.stats,
    },
  };
}

/**
 * Stages a DXF import without mutating the caller's current draft on any
 * importer, schema, or semantic validation error.
 */
export function stageDxfImport(
  text: string,
  fileName: string,
  currentDraftText: string,
): StudioDxfImportOutcome {
  const imported = importAnnotatedDxf(text, { fileName });
  return stageImportedResult(imported, fileName, currentDraftText);
}

export function stageMappedDxfImport(
  text: string,
  fileName: string,
  currentDraftText: string,
  profile: DxfLayerMappingProfile,
): StudioDxfImportOutcome {
  const prepared = applyDxfLayerMapping(text, profile);
  if (!prepared.text) {
    return {
      draftText: currentDraftText,
      draftName: null,
      report: {
        accepted: false,
        fileName,
        detectedUnits: prepared.inspection.detectedUnits,
        issues: prepared.issues.map((entry) => ({ ...entry, stage: 'dxf' })),
        stats: emptyImportStats(
          prepared.inspection.layers.reduce((total, layer) => total + layer.entityCount, 0),
        ),
      },
    };
  }
  const imported = importAnnotatedDxf(prepared.text, { fileName });
  return stageImportedResult(imported, fileName, currentDraftText, prepared.issues);
}
