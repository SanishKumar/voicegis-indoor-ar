import {
  DXF_LAYER_MAPPING_PROFILE_VERSION,
  type DxfImportIssue,
  type DxfLayerMappingProfile,
  type DxfLayerSummary,
  type DxfSelectableEntitySummary,
} from '@voicegis/dxf-importer';
import type { ConnectorKind, PortalKind, SpaceType } from '@voicegis/spatial-schema';

export type DxfLayerRole = 'ignore' | 'floor' | 'space' | 'portal' | 'poi' | 'connector';
export type ExplicitBoolean = '' | 'true' | 'false';

export interface DxfLayerMappingDraft {
  sourceLayer: string;
  sourceEntityKey: string | null;
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
  portalKind: PortalKind | '';
  spaceA: string;
  spaceB: string;
  restrictedPolicy: ExplicitBoolean;
  spaceId: string;
  poiCategory: string;
  connectorKind: ConnectorKind | '';
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

export function createDxfLayerMappingDraft(
  layer: DxfLayerSummary,
  entity?: DxfSelectableEntitySummary,
  entityNumber = 0,
): DxfLayerMappingDraft {
  const entitySuffix = entity ? `-${entityNumber + 1}` : '';
  const displaySuffix = entity ? ` ${entityNumber + 1}` : '';
  return {
    sourceLayer: layer.name,
    sourceEntityKey: entity?.key ?? null,
    role: 'ignore',
    id: `${layerId(layer.name)}${entitySuffix}`,
    name: `${layerDisplayName(layer.name)}${displaySuffix}`,
    floorId: '',
    level: '0',
    elevation: '0',
    clearHeight: '3.2',
    spaceType: '',
    publicPolicy: '',
    accessiblePolicy: '',
    portalKind: '',
    spaceA: '',
    spaceB: '',
    restrictedPolicy: '',
    spaceId: '',
    poiCategory: '',
    connectorKind: '',
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

    if (draft.role === 'floor') {
      if (!name)
        addIssue(issues, 'missing-mapping-name', `${path}/name`, 'Display name is required.');
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
          ...(draft.sourceEntityKey ? { sourceEntityKey: draft.sourceEntityKey } : {}),
          targetLayer: `VG$FLOOR$${draft.id}$${level}$${elevation}$${clearHeight}$${encodeURIComponent(name)}`,
        });
      }
      return;
    }

    if (draft.role === 'portal') {
      const floorIdValid = validateIdentity(
        draft.floorId,
        issues,
        `${path}/floorId`,
        'Portal floor id',
      );
      const spaceAValid = validateIdentity(
        draft.spaceA,
        issues,
        `${path}/spaceA`,
        'Portal start space id',
      );
      const spaceBValid = validateIdentity(
        draft.spaceB,
        issues,
        `${path}/spaceB`,
        'Portal end space id',
      );
      if (!draft.portalKind) {
        addIssue(issues, 'missing-portal-kind', `${path}/portalKind`, 'Portal kind is required.');
      }
      if (draft.spaceA && draft.spaceA === draft.spaceB) {
        addIssue(
          issues,
          'duplicate-portal-spaces',
          `${path}/spaceB`,
          'A portal must connect two different spaces.',
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
      if (!draft.restrictedPolicy) {
        addIssue(
          issues,
          'missing-restricted-policy',
          `${path}/restrictedPolicy`,
          'Restricted policy must be explicitly reviewed.',
        );
      }
      if (
        idValid &&
        floorIdValid &&
        spaceAValid &&
        spaceBValid &&
        draft.spaceA !== draft.spaceB &&
        draft.portalKind &&
        draft.accessiblePolicy &&
        draft.restrictedPolicy
      ) {
        mappings.push({
          sourceLayer: draft.sourceLayer,
          ...(draft.sourceEntityKey ? { sourceEntityKey: draft.sourceEntityKey } : {}),
          targetLayer: `VG$PORTAL$${draft.floorId}$${draft.id}$${draft.portalKind}$${draft.spaceA}$${draft.spaceB}$${draft.accessiblePolicy}$${draft.restrictedPolicy}`,
        });
      }
      return;
    }

    if (draft.role === 'connector') {
      if (!name)
        addIssue(issues, 'missing-mapping-name', `${path}/name`, 'Display name is required.');
      const floorIdValid = validateIdentity(
        draft.floorId,
        issues,
        `${path}/floorId`,
        'Connector-stop floor id',
      );
      const spaceIdValid = validateIdentity(
        draft.spaceId,
        issues,
        `${path}/spaceId`,
        'Connector-stop space id',
      );
      if (!draft.connectorKind) {
        addIssue(
          issues,
          'missing-connector-kind',
          `${path}/connectorKind`,
          'Connector kind is required.',
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
      if (!draft.restrictedPolicy) {
        addIssue(
          issues,
          'missing-restricted-policy',
          `${path}/restrictedPolicy`,
          'Restricted policy must be explicitly reviewed.',
        );
      }
      if (
        idValid &&
        floorIdValid &&
        spaceIdValid &&
        name &&
        draft.connectorKind &&
        draft.accessiblePolicy &&
        draft.restrictedPolicy
      ) {
        mappings.push({
          sourceLayer: draft.sourceLayer,
          ...(draft.sourceEntityKey ? { sourceEntityKey: draft.sourceEntityKey } : {}),
          targetLayer: `VG$CONNECTOR$${draft.id}$${draft.connectorKind}$${draft.accessiblePolicy}$${draft.restrictedPolicy}$${draft.floorId}$${draft.spaceId}$${encodeURIComponent(name)}`,
        });
      }
      return;
    }

    if (draft.role === 'poi') {
      if (!name)
        addIssue(issues, 'missing-mapping-name', `${path}/name`, 'Display name is required.');
      const floorIdValid = validateIdentity(
        draft.floorId,
        issues,
        `${path}/floorId`,
        'POI floor id',
      );
      const spaceIdValid = validateIdentity(
        draft.spaceId,
        issues,
        `${path}/spaceId`,
        'POI space id',
      );
      const category = draft.poiCategory.trim();
      if (!category) {
        addIssue(
          issues,
          'missing-poi-category',
          `${path}/poiCategory`,
          'POI category is required.',
        );
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
        spaceIdValid &&
        name &&
        category &&
        draft.publicPolicy &&
        draft.accessiblePolicy
      ) {
        mappings.push({
          sourceLayer: draft.sourceLayer,
          ...(draft.sourceEntityKey ? { sourceEntityKey: draft.sourceEntityKey } : {}),
          targetLayer: `VG$POI$${draft.floorId}$${draft.spaceId}$${draft.id}$${encodeURIComponent(category)}$${draft.publicPolicy}$${draft.accessiblePolicy}$${encodeURIComponent(name)}`,
        });
      }
      return;
    }

    if (!name)
      addIssue(issues, 'missing-mapping-name', `${path}/name`, 'Display name is required.');

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
        ...(draft.sourceEntityKey ? { sourceEntityKey: draft.sourceEntityKey } : {}),
        targetLayer: `VG$SPACE$${draft.floorId}$${draft.id}$${draft.spaceType}$${draft.publicPolicy}$${draft.accessiblePolicy}$${encodeURIComponent(name)}`,
      });
    }
  });

  const connectorGroups = new Map<string, Array<{ draft: DxfLayerMappingDraft; index: number }>>();
  drafts.forEach((draft, index) => {
    if (draft.role !== 'connector' || !ID_PATTERN.test(draft.id)) return;
    const group = connectorGroups.get(draft.id) ?? [];
    group.push({ draft, index });
    connectorGroups.set(draft.id, group);
  });
  connectorGroups.forEach((group, connectorId) => {
    const first = group[0];
    if (group.length < 2) {
      addIssue(
        issues,
        'connector-requires-two-stops',
        `/mappings/${first.index}/id`,
        `Connector "${connectorId}" requires at least two mapped stops.`,
      );
    }
    const usedFloors = new Set<string>();
    const firstMetadataComplete =
      first.draft.name.trim() &&
      first.draft.connectorKind &&
      first.draft.accessiblePolicy &&
      first.draft.restrictedPolicy;
    group.forEach(({ draft, index }) => {
      if (draft.floorId && usedFloors.has(draft.floorId)) {
        addIssue(
          issues,
          'duplicate-connector-floor-stop',
          `/mappings/${index}/floorId`,
          `Connector "${connectorId}" cannot have more than one stop on floor "${draft.floorId}".`,
        );
      }
      if (draft.floorId) usedFloors.add(draft.floorId);
      const metadataComplete =
        draft.name.trim() &&
        draft.connectorKind &&
        draft.accessiblePolicy &&
        draft.restrictedPolicy;
      if (
        firstMetadataComplete &&
        metadataComplete &&
        (draft.name.trim() !== first.draft.name.trim() ||
          draft.connectorKind !== first.draft.connectorKind ||
          draft.accessiblePolicy !== first.draft.accessiblePolicy ||
          draft.restrictedPolicy !== first.draft.restrictedPolicy)
      ) {
        addIssue(
          issues,
          'inconsistent-connector-metadata',
          `/mappings/${index}`,
          `Every stop for connector "${connectorId}" must use the same name, kind, accessibility, and restriction policy.`,
        );
      }
    });
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
            mappings: mappings.sort(
              (a, b) =>
                a.sourceLayer.localeCompare(b.sourceLayer) ||
                (a.sourceEntityKey ?? '').localeCompare(b.sourceEntityKey ?? ''),
            ),
          }
        : null,
    issues: sorted,
  };
}
