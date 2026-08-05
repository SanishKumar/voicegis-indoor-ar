import { describe, expect, it } from 'vitest';
import {
  DXF_LAYER_MAPPING_PROFILE_VERSION,
  type DxfInspectionResult,
  type DxfLayerMappingProfile,
} from '@voicegis/dxf-importer';
import {
  DXF_MAPPING_PROFILE_ARTIFACT_VERSION,
  createDxfMappingProfileArtifact,
  parseDxfMappingProfileArtifact,
} from './dxfMappingProfileArtifact';
import {
  buildDxfLayerMappingProfile,
  restoreDxfLayerMappingDrafts,
} from './dxfLayerMappingWorkspace';

const inspection: DxfInspectionResult = {
  valid: true,
  detectedUnits: 'meters',
  issues: [],
  layers: [
    {
      name: 'A-ANCHORS',
      entityCount: 2,
      entityTypes: ['POINT'],
      closedLightweightPolylines: 0,
      selectableEntities: [
        { key: 'point:2,2', type: 'POINT', point: [2, 2], occurrenceCount: 1 },
        { key: 'point:6,6', type: 'POINT', point: [6, 6], occurrenceCount: 1 },
      ],
    },
    {
      name: 'A-DOORS',
      entityCount: 1,
      entityTypes: ['LINE'],
      closedLightweightPolylines: 0,
      selectableEntities: [],
    },
    {
      name: 'A-FLOOR-OUTLINE',
      entityCount: 1,
      entityTypes: ['LWPOLYLINE'],
      closedLightweightPolylines: 1,
      selectableEntities: [],
    },
    {
      name: 'A-POIS',
      entityCount: 1,
      entityTypes: ['POINT'],
      closedLightweightPolylines: 0,
      selectableEntities: [],
    },
    {
      name: 'A-SPACE-ENTRY',
      entityCount: 1,
      entityTypes: ['LWPOLYLINE'],
      closedLightweightPolylines: 1,
      selectableEntities: [],
    },
    {
      name: 'A-SPACE-GALLERY',
      entityCount: 1,
      entityTypes: ['LWPOLYLINE'],
      closedLightweightPolylines: 1,
      selectableEntities: [],
    },
  ],
};

const profile: DxfLayerMappingProfile = {
  profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
  mappings: [
    {
      sourceLayer: 'A-ANCHORS',
      sourceEntityKey: 'point:2,2',
      targetLayer: 'VG$ANCHOR$g$entry$entry-anchor$qr$90$vg%3Aentry-anchor',
    },
    {
      sourceLayer: 'A-ANCHORS',
      sourceEntityKey: 'point:6,6',
      targetLayer: 'VG$ANCHOR$g$gallery$gallery-anchor$apriltag$270$vg%3Agallery-anchor',
    },
    {
      sourceLayer: 'A-DOORS',
      targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
    },
    {
      sourceLayer: 'A-FLOOR-OUTLINE',
      targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
    },
    {
      sourceLayer: 'A-POIS',
      targetLayer: 'VG$POI$g$entry$reception$visitor%20service$true$true$Reception',
    },
    {
      sourceLayer: 'A-SPACE-ENTRY',
      targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry%20Lobby',
    },
    {
      sourceLayer: 'A-SPACE-GALLERY',
      targetLayer: 'VG$SPACE$g$gallery$room$true$false$Gallery',
    },
  ],
};

describe('CAD mapping profile artifacts', () => {
  it('round-trips a completed profile through an artifact without drift', async () => {
    const artifact = await createDxfMappingProfileArtifact(profile, 'shared-anchors-v0.dxf');
    const parsed = parseDxfMappingProfileArtifact(artifact.text);
    const restored = restoreDxfLayerMappingDrafts(inspection, parsed.profile!);
    const rebuilt = buildDxfLayerMappingProfile(restored.drafts!);

    expect(parsed.valid).toBe(true);
    expect(parsed.sourceFileName).toBe('shared-anchors-v0.dxf');
    expect(restored.valid).toBe(true);
    expect(rebuilt.valid).toBe(true);
    expect(rebuilt.profile).toEqual(profile);
  });

  it('produces a stable artifact hash for the same profile', async () => {
    const first = await createDxfMappingProfileArtifact(profile, 'shared-anchors-v0.dxf');
    const second = await createDxfMappingProfileArtifact(
      { ...profile, mappings: [...profile.mappings] },
      'shared-anchors-v0.dxf',
    );

    expect(second.artifactHash).toBe(first.artifactHash);
    expect(second.fileName).toBe(first.fileName);
    expect(first.fileName).toMatch(/^shared-anchors-v0\.[a-f0-9]{12}\.cad-mapping-profile\.json$/);
    expect(first.mappingCount).toBe(7);
  });

  it('restores every mapped role back into reviewable draft fields', () => {
    const restored = restoreDxfLayerMappingDrafts(inspection, profile);
    const byRole = Object.fromEntries(
      restored.drafts!.filter((draft) => draft.role !== 'ignore').map((draft) => [draft.role, draft]),
    );

    expect(byRole.floor).toMatchObject({ id: 'g', name: 'Ground Floor', clearHeight: '3.2' });
    expect(byRole.space).toMatchObject({
      id: 'gallery',
      spaceType: 'room',
      publicPolicy: 'true',
      accessiblePolicy: 'false',
    });
    expect(byRole.portal).toMatchObject({
      portalKind: 'door',
      spaceA: 'entry',
      spaceB: 'gallery',
      restrictedPolicy: 'false',
    });
    expect(byRole.poi).toMatchObject({ poiCategory: 'visitor service', name: 'Reception' });
    expect(byRole.anchor).toMatchObject({
      anchorKind: 'apriltag',
      headingDegrees: '270',
      anchorPayload: 'vg:gallery-anchor',
    });
  });

  it('rejects a profile whose selections this drawing no longer offers', () => {
    const stale = restoreDxfLayerMappingDrafts(inspection, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-ANCHORS',
          sourceEntityKey: 'point:9,9',
          targetLayer: 'VG$ANCHOR$g$entry$entry-anchor$qr$90$vg%3Aentry-anchor',
        },
        {
          sourceLayer: 'A-MISSING',
          targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
        },
      ],
    });

    expect(stale.valid).toBe(false);
    expect(stale.drafts).toBeNull();
    expect(stale.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-profile-selection' }),
        expect.objectContaining({ code: 'unknown-profile-selection' }),
      ]),
    );
  });

  it('refuses a whole-layer mapping once that layer holds several entities', () => {
    const restored = restoreDxfLayerMappingDrafts(inspection, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-ANCHORS',
          targetLayer: 'VG$ANCHOR$g$entry$entry-anchor$qr$90$vg%3Aentry-anchor',
        },
      ],
    });

    expect(restored.valid).toBe(false);
    expect(restored.drafts).toBeNull();
    expect(restored.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unknown-profile-selection' })]),
    );
  });

  it('refuses hand-edited target layers that bypass the mapping forms', () => {
    const restored = restoreDxfLayerMappingDrafts(inspection, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-SPACE-ENTRY',
          targetLayer: 'VG$SPACE$g$entry$entrance$yes$true$Entry',
        },
        {
          sourceLayer: 'A-SPACE-GALLERY',
          targetLayer: 'VG$SPACE$g$gallery$vault$true$true$Gallery',
        },
        {
          sourceLayer: 'A-FLOOR-OUTLINE',
          targetLayer: 'VG$ZONE$g$fire-compartment',
        },
      ],
    });

    expect(restored.valid).toBe(false);
    expect(restored.drafts).toBeNull();
    expect(restored.issues.filter((entry) => entry.code === 'unsupported-profile-target')).toHaveLength(
      3,
    );
  });

  it('rejects malformed and mismatched artifacts before any draft is touched', () => {
    const notJson = parseDxfMappingProfileArtifact('{ not json');
    const wrongVersion = parseDxfMappingProfileArtifact(
      JSON.stringify({
        artifactVersion: '9.9.9',
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: profile.mappings,
      }),
    );
    const malformedMapping = parseDxfMappingProfileArtifact(
      JSON.stringify({
        artifactVersion: DXF_MAPPING_PROFILE_ARTIFACT_VERSION,
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [{ sourceLayer: 'A-DOORS' }],
      }),
    );
    const empty = parseDxfMappingProfileArtifact(
      JSON.stringify({
        artifactVersion: DXF_MAPPING_PROFILE_ARTIFACT_VERSION,
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [],
      }),
    );

    expect(notJson.profile).toBeNull();
    expect(notJson.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-profile-json' })]),
    );
    expect(wrongVersion.profile).toBeNull();
    expect(wrongVersion.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported-profile-artifact' })]),
    );
    expect(malformedMapping.profile).toBeNull();
    expect(malformedMapping.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-profile-artifact' })]),
    );
    expect(empty.profile).toBeNull();
    expect(empty.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'empty-layer-mapping' })]),
    );
  });
});
