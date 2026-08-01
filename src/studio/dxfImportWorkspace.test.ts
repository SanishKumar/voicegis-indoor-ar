import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DXF_LAYER_MAPPING_PROFILE_VERSION } from '@voicegis/dxf-importer';
import { stageDxfImport, stageMappedDxfImport } from './dxfImportWorkspace';

const fixture = readFileSync(
  new URL('../../buildings/import-fixtures/atrium-dxf-v0.dxf', import.meta.url),
  'utf8',
);
const unannotatedFixture = readFileSync(
  new URL('../../buildings/import-fixtures/unannotated-lobby-v0.dxf', import.meta.url),
  'utf8',
);
const twoRoomFixture = readFileSync(
  new URL('../../buildings/import-fixtures/unannotated-two-room-v0.dxf', import.meta.url),
  'utf8',
);
const sharedRoomsFixture = readFileSync(
  new URL('../../buildings/import-fixtures/unannotated-shared-rooms-v0.dxf', import.meta.url),
  'utf8',
);
const sharedDoorsFixture = readFileSync(
  new URL('../../buildings/import-fixtures/unannotated-shared-doors-v0.dxf', import.meta.url),
  'utf8',
);
const sharedPoisFixture = readFileSync(
  new URL('../../buildings/import-fixtures/unannotated-shared-pois-v0.dxf', import.meta.url),
  'utf8',
);
const sharedConnectorStopsFixture = readFileSync(
  new URL(
    '../../buildings/import-fixtures/unannotated-shared-connector-stops-v0.dxf',
    import.meta.url,
  ),
  'utf8',
);

describe('Studio DXF staging boundary', () => {
  it('replaces the draft only after importer and semantic validation pass', () => {
    const outcome = stageDxfImport(fixture, 'atrium-dxf-v0.dxf', 'current draft');

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.draftName).toBe('atrium-dxf-v0.json');
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      building: { id: 'atrium-dxf-v0', entrySpaceId: 'g-lobby' },
    });
  });

  it('preserves the exact current draft when DXF parsing fails', () => {
    const currentDraft = '{"current":true}\n';
    const outcome = stageDxfImport('not a DXF', 'broken.dxf', currentDraft);

    expect(outcome.report.accepted).toBe(false);
    expect(outcome.draftText).toBe(currentDraft);
    expect(outcome.draftName).toBeNull();
    expect(outcome.report.issues.some((entry) => entry.severity === 'error')).toBe(true);
  });

  it('preserves the exact current draft when compiler semantics fail', () => {
    const currentDraft = '{"current":true}\n';
    const disconnected = fixture.replace(
      'VG$PORTAL$g$lobby-opening$opening$g-lobby$g-concourse$true$false',
      'UNANNOTATED',
    );
    const outcome = stageDxfImport(disconnected, 'disconnected.dxf', currentDraft);

    expect(outcome.report.accepted).toBe(false);
    expect(outcome.draftText).toBe(currentDraft);
    expect(outcome.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'semantic', code: 'unreachable-public-space' }),
      ]),
    );
  });

  it('stages an explicitly mapped ordinary DXF without auto-activating anything', () => {
    const outcome = stageMappedDxfImport(
      unannotatedFixture,
      'unannotated-lobby-v0.dxf',
      'current draft',
      {
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [
          {
            sourceLayer: 'A-FLOOR-OUTLINE',
            targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
          },
          {
            sourceLayer: 'A-SPACE-ENTRY',
            targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry%20Lobby',
          },
        ],
      },
    );

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.draftName).toBe('unannotated-lobby-v0.json');
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      building: { entrySpaceId: 'entry' },
    });
  });

  it('preserves the exact draft when a mapped source layer is invalid', () => {
    const currentDraft = '{"current":true}\n';
    const outcome = stageMappedDxfImport(
      unannotatedFixture,
      'unannotated-lobby-v0.dxf',
      currentDraft,
      {
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [
          {
            sourceLayer: 'A-ANNOTATION',
            targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
          },
        ],
      },
    );

    expect(outcome.report.accepted).toBe(false);
    expect(outcome.draftText).toBe(currentDraft);
    expect(outcome.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'layer-not-single-closed-polyline' }),
      ]),
    );
  });

  it('stages a mapped portal only after the compiled venue remains semantically valid', () => {
    const outcome = stageMappedDxfImport(
      twoRoomFixture,
      'unannotated-two-room-v0.dxf',
      'current draft',
      {
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [
          {
            sourceLayer: 'A-FLOOR-OUTLINE',
            targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
          },
          {
            sourceLayer: 'A-SPACE-ENTRY',
            targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry%20Lobby',
          },
          {
            sourceLayer: 'A-SPACE-GALLERY',
            targetLayer: 'VG$SPACE$g$gallery$room$true$true$Gallery',
          },
          {
            sourceLayer: 'A-DOOR-ENTRY-GALLERY',
            targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
          },
        ],
      },
    );

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.report.stats).toMatchObject({ floors: 1, spaces: 2, portals: 1 });
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      building: { entrySpaceId: 'entry' },
      portals: [{ id: 'entry-gallery-door', connects: ['entry', 'gallery'] }],
    });
  });

  it('stages two individually selected spaces from one shared CAD layer', () => {
    const outcome = stageMappedDxfImport(
      sharedRoomsFixture,
      'unannotated-shared-rooms-v0.dxf',
      'current draft',
      {
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [
          {
            sourceLayer: 'A-FLOOR-OUTLINE',
            targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
          },
          {
            sourceLayer: 'A-ROOMS',
            sourceEntityKey: 'lwpolyline:0,0;4,0;4,8;0,8',
            targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
          },
          {
            sourceLayer: 'A-ROOMS',
            sourceEntityKey: 'lwpolyline:4,0;12,0;12,8;4,8',
            targetLayer: 'VG$SPACE$g$gallery$room$true$true$Gallery',
          },
          {
            sourceLayer: 'A-DOOR-ENTRY-GALLERY',
            targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
          },
        ],
      },
    );

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.report.stats).toMatchObject({ floors: 1, spaces: 2, portals: 1 });
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      spaces: [{ id: 'entry' }, { id: 'gallery' }],
    });
  });

  it('stages two individually selected portals from one shared CAD layer', () => {
    const outcome = stageMappedDxfImport(
      sharedDoorsFixture,
      'unannotated-shared-doors-v0.dxf',
      'current draft',
      {
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [
          {
            sourceLayer: 'A-FLOOR-OUTLINE',
            targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
          },
          {
            sourceLayer: 'A-SPACE-ENTRY',
            targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
          },
          {
            sourceLayer: 'A-SPACE-GALLERY',
            targetLayer: 'VG$SPACE$g$gallery$room$true$true$Gallery',
          },
          {
            sourceLayer: 'A-SPACE-ARCHIVE',
            targetLayer: 'VG$SPACE$g$archive$room$true$true$Archive',
          },
          {
            sourceLayer: 'A-DOORS',
            sourceEntityKey: 'line:4,3.5;4,4.5',
            targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
          },
          {
            sourceLayer: 'A-DOORS',
            sourceEntityKey: 'line:8,3.5;8,4.5',
            targetLayer: 'VG$PORTAL$g$gallery-archive-door$door$gallery$archive$true$false',
          },
        ],
      },
    );

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.report.stats).toMatchObject({ floors: 1, spaces: 3, portals: 2 });
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      portals: [{ id: 'entry-gallery-door' }, { id: 'gallery-archive-door' }],
    });
  });

  it('stages two individually selected POIs from one shared CAD layer', () => {
    const outcome = stageMappedDxfImport(
      sharedPoisFixture,
      'unannotated-shared-pois-v0.dxf',
      'current draft',
      {
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [
          {
            sourceLayer: 'A-FLOOR-OUTLINE',
            targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
          },
          {
            sourceLayer: 'A-SPACE-ENTRY',
            targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
          },
          {
            sourceLayer: 'A-SPACE-GALLERY',
            targetLayer: 'VG$SPACE$g$gallery$room$true$true$Gallery',
          },
          {
            sourceLayer: 'A-SPACE-ARCHIVE',
            targetLayer: 'VG$SPACE$g$archive$room$true$true$Archive',
          },
          {
            sourceLayer: 'A-DOORS',
            sourceEntityKey: 'line:4,3.5;4,4.5',
            targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
          },
          {
            sourceLayer: 'A-DOORS',
            sourceEntityKey: 'line:8,3.5;8,4.5',
            targetLayer: 'VG$PORTAL$g$gallery-archive-door$door$gallery$archive$true$false',
          },
          {
            sourceLayer: 'A-POIS',
            sourceEntityKey: 'point:1.5,4',
            targetLayer: 'VG$POI$g$entry$reception$service$true$true$Reception',
          },
          {
            sourceLayer: 'A-POIS',
            sourceEntityKey: 'point:6,4',
            targetLayer: 'VG$POI$g$gallery$featured-exhibit$exhibit$true$true$Featured%20Exhibit',
          },
        ],
      },
    );

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.report.stats).toMatchObject({ floors: 1, spaces: 3, portals: 2, pois: 2 });
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      pois: [
        { id: 'featured-exhibit', spaceId: 'gallery', position: [6, 4] },
        { id: 'reception', spaceId: 'entry', position: [1.5, 4] },
      ],
    });
  });

  it('stages a grouped multi-floor connector from individually selected points', () => {
    const outcome = stageMappedDxfImport(
      sharedConnectorStopsFixture,
      'unannotated-shared-connector-stops-v0.dxf',
      'current draft',
      {
        profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
        mappings: [
          {
            sourceLayer: 'A-FLOOR-G',
            targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground',
          },
          {
            sourceLayer: 'A-FLOOR-L1',
            targetLayer: 'VG$FLOOR$l1$1$3.2$3.2$Level%201',
          },
          {
            sourceLayer: 'A-SPACE-ENTRY',
            targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
          },
          {
            sourceLayer: 'A-SPACE-GALLERY',
            targetLayer: 'VG$SPACE$l1$gallery$room$true$true$Gallery',
          },
          {
            sourceLayer: 'A-RAMP-STOPS',
            sourceEntityKey: 'point:4,4',
            targetLayer: 'VG$CONNECTOR$east-ramp$ramp$true$false$g$entry$East%20Ramp',
          },
          {
            sourceLayer: 'A-RAMP-STOPS',
            sourceEntityKey: 'point:4.2,4',
            targetLayer: 'VG$CONNECTOR$east-ramp$ramp$true$false$l1$gallery$East%20Ramp',
          },
        ],
      },
    );

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.report.stats).toMatchObject({
      floors: 2,
      spaces: 2,
      portals: 0,
      connectors: 1,
    });
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      verticalConnectors: [
        {
          id: 'east-ramp',
          kind: 'ramp',
          accessible: true,
          stops: [
            { floorId: 'g', spaceId: 'entry', position: [4, 4] },
            { floorId: 'l1', spaceId: 'gallery', position: [4.2, 4] },
          ],
        },
      ],
    });
  });
});
