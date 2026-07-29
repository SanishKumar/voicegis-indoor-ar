import {
  prepareBuildingCompilation,
  stableJson,
  type CompiledBuildingPackage,
} from './compilerCore';
import type { ValidationReport } from './validation';

export interface BrowserCompilationResult {
  package: CompiledBuildingPackage | null;
  report: ValidationReport;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function compileBuildingInBrowser(value: unknown): Promise<BrowserCompilationResult> {
  const preparation = prepareBuildingCompilation(value);
  if (!preparation.content) {
    return { package: null, report: preparation.report };
  }

  const contentHash = await sha256Hex(stableJson(preparation.content));
  return {
    package: {
      ...preparation.content,
      manifest: { hashAlgorithm: 'sha256', contentHash },
    },
    report: preparation.report,
  };
}
