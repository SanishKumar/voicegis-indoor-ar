import {
  importAnnotatedDxf,
  type DxfImportIssue,
  type DxfImportStats,
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
  const dxfIssues: StudioDxfImportIssue[] = imported.issues.map((entry) => ({
    ...entry,
    stage: 'dxf',
  }));

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
