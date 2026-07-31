import {
  DXF_LAYER_MAPPING_PROFILE_VERSION,
  type DxfImportIssue,
  type DxfLayerMappingProfile,
  type DxfLayerSummary,
} from '@voicegis/dxf-importer';
import type { SpaceType } from '@voicegis/spatial-schema';

export type DxfLayerRole = 'ignore' | 'floor' | 'space';
export type ExplicitBoolean = '' | 'true' | 'false';

export interface DxfLayerMappingDraft {
  sourceLayer: string;
  role: DxfLayerRole;
  id: string;
  name: string;
  floorId: string;
  level: string;
  elevation: string;
  clearHeight: string;
  spaceType: SpaceType | '';
  publicPolicy: ExplicitBoolean;
  accessiblePolicy: ExplicitBoolean;
}

export interface DxfMappingProfileDraftResult {
  valid: boolean;
  profile: DxfLayerMappingProfile | null;
  issues: DxfImportIssue[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function layerId(layerName: string) {
  const normalized = layerName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 96);
  return normalized || 'mapped-layer';
}

function layerDisplayName(layerName: string) {
  return layerName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function createDxfLayerMappingDraft(layer: DxfLayerSummary): DxfLayerMappingDraft {
  return {
    sourceLayer: layer.name,
    role: 'ignore',
    id: layerId(layer.name),
    name: layerDisplayName(layer.name),
    floorId: '',
    level: '0',
    elevation: '0',
    clearHeight: '3.2',
    spaceType: '',
    publicPolicy: '',
    accessiblePolicy: '',
  };
}

function addIssue(issues: DxfImportIssue[], code: string, path: string, message: string) {
  issues.push({ severity: 'error', code, path, message });
}

function validateIdentity(value: string, issues: DxfImportIssue[], path: string, label: string) {
  if (!ID_PATTERN.test(value) || value.length > 96) {
    addIssue(issues, 'invalid-mapping-id', path, `${label} must be a lowercase canonical id.`);
    return false;
  }
  return true;
}

function finiteNumber(value: string, issues: DxfImportIssue[], path: string, label: string) {
  if (value.trim() === '') {
    addIssue(issues, 'invalid-mapping-number', path, `${label} is required.`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    addIssue(issues, 'invalid-mapping-number', path, `${label} must be a finite number.`);
    return null;
  }
  return parsed;
}

export function buildDxfLayerMappingProfile(
  drafts: DxfLayerMappingDraft[],
): DxfMappingProfileDraftResult {
  const issues: DxfImportIssue[] = [];
  const mappings: DxfLayerMappingProfile['mappings'] = [];

  drafts.forEach((draft, index) => {
    if (draft.role === 'ignore') return;
    const path = `/mappings/${index}`;
    const idValid = validateIdentity(draft.id, issues, `${path}/id`, `${draft.role} id`);
    const name = draft.name.trim();
    if (!name)
      addIssue(issues, 'missing-mapping-name', `${path}/name`, 'Display name is required.');

    if (draft.role === 'floor') {
      const level = finiteNumber(draft.level, issues, `${path}/level`, 'Floor level');
      const elevation = finiteNumber(
        draft.elevation,
        issues,
        `${path}/elevation`,
        'Floor elevation',
      );
      const clearHeight = finiteNumber(
        draft.clearHeight,
        issues,
        `${path}/clearHeight`,
        'Floor clear height',
      );
      if (level !== null && !Number.isInteger(level)) {
        addIssue(issues, 'invalid-floor-level', `${path}/level`, 'Floor level must be an integer.');
      }
      if (clearHeight !== null && clearHeight <= 0) {
        addIssue(
          issues,
          'invalid-clear-height',
          `${path}/clearHeight`,
          'Floor clear height must be greater than zero.',
        );
      }
      if (
        idValid &&
        name &&
        level !== null &&
        Number.isInteger(level) &&
        elevation !== null &&
        clearHeight !== null &&
        clearHeight > 0
      ) {
        mappings.push({
          sourceLayer: draft.sourceLayer,
          targetLayer: `VG$FLOOR$${draft.id}$${level}$${elevation}$${clearHeight}$${encodeURIComponent(name)}`,
        });
      }
      return;
    }

    const floorIdValid = validateIdentity(
      draft.floorId,
      issues,
      `${path}/floorId`,
      'Space floor id',
    );
    if (!draft.spaceType) {
      addIssue(issues, 'missing-space-type', `${path}/spaceType`, 'Space type is required.');
    }
    if (!draft.publicPolicy) {
      addIssue(
        issues,
        'missing-public-policy',
        `${path}/publicPolicy`,
        'Public policy must be explicitly reviewed.',
      );
    }
    if (!draft.accessiblePolicy) {
      addIssue(
        issues,
        'missing-accessibility-policy',
        `${path}/accessiblePolicy`,
        'Accessibility policy must be explicitly reviewed.',
      );
    }
    if (
      idValid &&
      floorIdValid &&
      name &&
      draft.spaceType &&
      draft.publicPolicy &&
      draft.accessiblePolicy
    ) {
      mappings.push({
        sourceLayer: draft.sourceLayer,
        targetLayer: `VG$SPACE$${draft.floorId}$${draft.id}$${draft.spaceType}$${draft.publicPolicy}$${draft.accessiblePolicy}$${encodeURIComponent(name)}`,
      });
    }
  });

  if (!drafts.some((draft) => draft.role === 'floor')) {
    addIssue(issues, 'missing-floor-mapping', '/mappings', 'Map at least one floor layer.');
  }
  if (!drafts.some((draft) => draft.role === 'space')) {
    addIssue(issues, 'missing-space-mapping', '/mappings', 'Map at least one space layer.');
  }

  const sorted = issues.sort(
    (a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path),
  );
  return {
    valid: sorted.length === 0,
    profile:
      sorted.length === 0
        ? {
            profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
            mappings: mappings.sort((a, b) => a.sourceLayer.localeCompare(b.sourceLayer)),
          }
        : null,
    issues: sorted,
  };
}
