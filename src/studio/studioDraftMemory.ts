import type { BrowserCompilationResult } from '@voicegis/map-compiler/browser';
import type { DxfInspectionResult } from '@voicegis/dxf-importer';
import type { StudioDxfImportReport } from './dxfImportWorkspace';
import type { VenuePackageArtifact } from './venuePackageArtifact';

export interface StudioDraftSession {
  draftText: string;
  draftName: string;
  editorMode: 'visual' | 'json';
  visualHistory: string[];
  fileMessage: string | null;
  dxfImportReport: StudioDxfImportReport | null;
  dxfMappingSession: { fileName: string; text: string; inspection: DxfInspectionResult } | null;
  compilePreview: {
    draftText: string;
    result: BrowserCompilationResult;
    artifact: VenuePackageArtifact;
  } | null;
}

/** Bounded operator-session memory only: no storage, server, or activation authority. */
export class StudioDraftMemory {
  private readonly entries = new Map<string, StudioDraftSession>();

  constructor(private readonly limit = 4) {}

  read(packageHash: string): StudioDraftSession | null {
    const saved = this.entries.get(packageHash);
    if (!saved) return null;
    this.entries.delete(packageHash);
    this.entries.set(packageHash, saved);
    return structuredClone(saved);
  }

  remember(packageHash: string, session: StudioDraftSession) {
    // Whitelist authoring state. In particular, never preserve activationArmed
    // or pending permission/publish requests when an operator leaves a tool.
    const {
      draftText,
      draftName,
      editorMode,
      visualHistory,
      fileMessage,
      dxfImportReport,
      dxfMappingSession,
      compilePreview,
    } = session;
    this.entries.delete(packageHash);
    this.entries.set(
      packageHash,
      structuredClone({
        draftText,
        draftName,
        editorMode,
        visualHistory,
        fileMessage,
        dxfImportReport,
        dxfMappingSession,
        compilePreview,
      }),
    );
    while (this.entries.size > this.limit) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export const studioDraftMemory = new StudioDraftMemory();
