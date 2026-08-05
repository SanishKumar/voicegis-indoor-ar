import {
  DXF_LAYER_MAPPING_PROFILE_VERSION,
  type DxfImportIssue,
  type DxfLayerMapping,
  type DxfLayerMappingProfile,
} from '@voicegis/dxf-importer';
import { stablePackageJson } from '../data/packageLifecycle';
import { calculateTextSha256, utf8ByteLength } from '../data/contentDigest';

export const DXF_MAPPING_PROFILE_ARTIFACT_VERSION = '0.1.0' as const;

export interface DxfMappingProfileArtifact {
  fileName: string;
  mediaType: 'application/json';
  text: string;
  byteLength: number;
  artifactHash: string;
  mappingCount: number;
}

export interface DxfMappingProfileArtifactParseResult {
  valid: boolean;
  profile: DxfLayerMappingProfile | null;
  sourceFileName: string | null;
  issues: DxfImportIssue[];
}

function issue(issues: DxfImportIssue[], code: string, path: string, message: string) {
  issues.push({ severity: 'error', code, path, message });
}

function artifactBaseName(sourceFileName: string) {
  const base = sourceFileName
    .replace(/\.dxf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'drawing';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Serializes a completed mapping profile as a reusable artifact. `sourceFileName`
 * is provenance only: loading never checks it, because the point of the artifact
 * is to be replayed against a different revision of the same drawing.
 */
export async function createDxfMappingProfileArtifact(
  profile: DxfLayerMappingProfile,
  sourceFileName: string,
): Promise<DxfMappingProfileArtifact> {
  const text = stablePackageJson({
    artifactVersion: DXF_MAPPING_PROFILE_ARTIFACT_VERSION,
    profileVersion: profile.profileVersion,
    sourceFileName,
    mappings: profile.mappings,
  });
  const artifactHash = await calculateTextSha256(text);
  return {
    fileName: `${artifactBaseName(sourceFileName)}.${artifactHash.slice(0, 12)}.cad-mapping-profile.json`,
    mediaType: 'application/json',
    text,
    byteLength: utf8ByteLength(text),
    artifactHash,
    mappingCount: profile.mappings.length,
  };
}

/**
 * Reads a saved mapping-profile artifact. Structural failures return no profile
 * at all, so a malformed file can never partially overwrite an open mapping.
 */
export function parseDxfMappingProfileArtifact(
  text: string,
): DxfMappingProfileArtifactParseResult {
  const issues: DxfImportIssue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    issue(issues, 'invalid-profile-json', '/', 'Mapping profile artifacts must be valid JSON.');
    return { valid: false, profile: null, sourceFileName: null, issues };
  }

  if (!isRecord(parsed)) {
    issue(issues, 'invalid-profile-artifact', '/', 'Mapping profile artifacts must be an object.');
    return { valid: false, profile: null, sourceFileName: null, issues };
  }

  if (parsed.artifactVersion !== DXF_MAPPING_PROFILE_ARTIFACT_VERSION) {
    issue(
      issues,
      'unsupported-profile-artifact',
      '/artifactVersion',
      `Expected mapping profile artifact ${DXF_MAPPING_PROFILE_ARTIFACT_VERSION}.`,
    );
  }
  if (parsed.profileVersion !== DXF_LAYER_MAPPING_PROFILE_VERSION) {
    issue(
      issues,
      'unsupported-mapping-profile',
      '/profileVersion',
      `Expected DXF layer mapping profile ${DXF_LAYER_MAPPING_PROFILE_VERSION}.`,
    );
  }
  if (parsed.sourceFileName !== undefined && typeof parsed.sourceFileName !== 'string') {
    issue(
      issues,
      'invalid-profile-artifact',
      '/sourceFileName',
      'Source file name must be a string when present.',
    );
  }

  const mappings: DxfLayerMapping[] = [];
  if (!Array.isArray(parsed.mappings)) {
    issue(
      issues,
      'invalid-profile-artifact',
      '/mappings',
      'Mapping profile artifacts must contain a mappings array.',
    );
  } else if (parsed.mappings.length === 0) {
    issue(issues, 'empty-layer-mapping', '/mappings', 'Mapping profile artifacts cannot be empty.');
  } else {
    parsed.mappings.forEach((entry, index) => {
      const path = `/mappings/${index}`;
      if (!isRecord(entry)) {
        issue(issues, 'invalid-profile-artifact', path, 'Every mapping must be an object.');
        return;
      }
      const { sourceLayer, sourceEntityKey, targetLayer } = entry;
      if (typeof sourceLayer !== 'string' || sourceLayer.length === 0) {
        issue(
          issues,
          'invalid-profile-artifact',
          `${path}/sourceLayer`,
          'Source layer must be a non-empty string.',
        );
        return;
      }
      if (typeof targetLayer !== 'string' || targetLayer.length === 0) {
        issue(
          issues,
          'invalid-profile-artifact',
          `${path}/targetLayer`,
          'Target layer must be a non-empty string.',
        );
        return;
      }
      if (sourceEntityKey !== undefined && typeof sourceEntityKey !== 'string') {
        issue(
          issues,
          'invalid-profile-artifact',
          `${path}/sourceEntityKey`,
          'Source entity key must be a string when present.',
        );
        return;
      }
      mappings.push({
        sourceLayer,
        ...(sourceEntityKey ? { sourceEntityKey } : {}),
        targetLayer,
      });
    });
  }

  const sorted = issues.sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path));
  if (sorted.length > 0) {
    return { valid: false, profile: null, sourceFileName: null, issues: sorted };
  }
  return {
    valid: true,
    profile: { profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION, mappings },
    sourceFileName: typeof parsed.sourceFileName === 'string' ? parsed.sourceFileName : null,
    issues: sorted,
  };
}
