import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileBuilding } from '@voicegis/map-compiler';
import {
  DXF_LAYER_MAPPING_PROFILE_VERSION,
  applyDxfLayerMapping,
  importAnnotatedDxf,
  inspectDxfLayers,
  type DxfLayerMappingProfile,
} from './index';

const fixtureUrl = new URL('../../../buildings/import-fixtures/atrium-dxf-v0.dxf', import.meta.url);
const fixture = readFileSync(fixtureUrl, 'utf8');
const unannotatedFixture = readFileSync(
  new URL('../../../buildings/import-fixtures/unannotated-lobby-v0.dxf', import.meta.url),
  'utf8',
);
const twoRoomFixture = readFileSync(
  new URL('../../../buildings/import-fixtures/unannotated-two-room-v0.dxf', import.meta.url),
  'utf8',
);
const sharedRoomsFixture = readFileSync(
  new URL('../../../buildings/import-fixtures/unannotated-shared-rooms-v0.dxf', import.meta.url),
  'utf8',
);
const sharedDoorsFixture = readFileSync(
  new URL('../../../buildings/import-fixtures/unannotated-shared-doors-v0.dxf', import.meta.url),
  'utf8',
);
const sharedPoisFixture = readFileSync(
  new URL('../../../buildings/import-fixtures/unannotated-shared-pois-v0.dxf', import.meta.url),
  'utf8',
);
const sharedConnectorStopsFixture = readFileSync(
  new URL(
    '../../../buildings/import-fixtures/unannotated-shared-connector-stops-v0.dxf',
    import.meta.url,
  ),
  'utf8',
);

const entryPolygonKey = 'lwpolyline:0,0;4,0;4,8;0,8';
const galleryPolygonKey = 'lwpolyline:4,0;12,0;12,8;4,8';
const entryDoorKey = 'line:4,3.5;4,4.5';
const archiveDoorKey = 'line:8,3.5;8,4.5';
const receptionPointKey = 'point:1.5,4';
const exhibitPointKey = 'point:6,4';
const groundRampPointKey = 'point:4,4';
const levelOneRampPointKey = 'point:4.2,4';

const unannotatedProfile: DxfLayerMappingProfile = {
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
};

const twoRoomProfile: DxfLayerMappingProfile = {
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
};

const sharedRoomsProfile: DxfLayerMappingProfile = {
  profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
  mappings: [
    {
      sourceLayer: 'A-FLOOR-OUTLINE',
      targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
    },
    {
      sourceLayer: 'A-ROOMS',
      sourceEntityKey: entryPolygonKey,
      targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry%20Lobby',
    },
    {
      sourceLayer: 'A-ROOMS',
      sourceEntityKey: galleryPolygonKey,
      targetLayer: 'VG$SPACE$g$gallery$room$true$true$Gallery',
    },
    {
      sourceLayer: 'A-DOOR-ENTRY-GALLERY',
      targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
    },
  ],
};

const sharedDoorsProfile: DxfLayerMappingProfile = {
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
      sourceEntityKey: entryDoorKey,
      targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
    },
    {
      sourceLayer: 'A-DOORS',
      sourceEntityKey: archiveDoorKey,
      targetLayer: 'VG$PORTAL$g$gallery-archive-door$door$gallery$archive$true$false',
    },
  ],
};

const sharedPoisProfile: DxfLayerMappingProfile = {
  profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
  mappings: [
    ...sharedDoorsProfile.mappings,
    {
      sourceLayer: 'A-POIS',
      sourceEntityKey: receptionPointKey,
      targetLayer: 'VG$POI$g$entry$reception$service$true$true$Reception',
    },
    {
      sourceLayer: 'A-POIS',
      sourceEntityKey: exhibitPointKey,
      targetLayer: 'VG$POI$g$gallery$featured-exhibit$exhibit$true$true$Featured%20Exhibit',
    },
  ],
};

const sharedConnectorStopsProfile: DxfLayerMappingProfile = {
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
      sourceEntityKey: groundRampPointKey,
      targetLayer: 'VG$CONNECTOR$east-ramp$ramp$true$false$g$entry$East%20Ramp',
    },
    {
      sourceLayer: 'A-RAMP-STOPS',
      sourceEntityKey: levelOneRampPointKey,
      targetLayer: 'VG$CONNECTOR$east-ramp$ramp$true$false$l1$gallery$East%20Ramp',
    },
  ],
};

function reorderEntities(text: string) {
  const marker = '0\nSECTION\n2\nENTITIES\n';
  const endMarker = '0\nENDSEC\n0\nEOF';
  const start = text.indexOf(marker);
  const end = text.indexOf(endMarker, start);
  const body = text.slice(start + marker.length, end);
  const entities = body
    .split(/(?=^0\n(?:LWPOLYLINE|LINE|POINT)\n)/m)
    .filter((entry) => entry.trim().length > 0);
  return `${text.slice(0, start + marker.length)}${entities.reverse().join('')}${text.slice(end)}`;
}

function oneSpaceDxf(unitsCode: number, size: number, policy = 'true$true') {
  return `0
SECTION
2
HEADER
9
$INSUNITS
70
${unitsCode}
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
VG$FLOOR$g$0$0$${size / 2}$Ground
90
4
70
1
10
0
20
0
10
${size}
20
0
10
${size}
20
${size}
10
0
20
${size}
0
LWPOLYLINE
8
VG$SPACE$g$entry$entrance$${policy}$Entry
90
4
70
1
10
0
20
0
10
${size}
20
0
10
${size}
20
${size}
10
0
20
${size}
0
ENDSEC
0
EOF
`;
}

describe('annotated DXF importer v0', () => {
  it('imports the checked-in fixture through the unchanged deterministic compiler', () => {
    const imported = importAnnotatedDxf(fixture, { fileName: 'atrium-dxf-v0.dxf' });

    expect(imported.valid).toBe(true);
    expect(imported.detectedUnits).toBe('meters');
    expect(imported.stats).toMatchObject({
      floors: 2,
      spaces: 3,
      portals: 1,
      connectors: 1,
      pois: 2,
      anchors: 1,
    });
    expect(imported.source?.building).toMatchObject({
      id: 'atrium-dxf-v0',
      entrySpaceId: 'g-lobby',
      units: 'meters',
    });

    const compiled = compileBuilding(imported.source);
    expect(compiled.report.valid).toBe(true);
    expect(compiled.package?.routing.nodes.length).toBeGreaterThan(0);
    expect(compiled.package?.routing.edges.some((edge) => edge.kind === 'vertical-connector')).toBe(
      true,
    );
    expect(compiled.package?.manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces identical source and package identity when DXF entities are reordered', () => {
    const first = importAnnotatedDxf(fixture, { fileName: 'atrium-dxf-v0.dxf' });
    const second = importAnnotatedDxf(reorderEntities(fixture), {
      fileName: 'atrium-dxf-v0.dxf',
    });

    expect(second.source).toEqual(first.source);
    expect(compileBuilding(second.source).package?.manifest.contentHash).toBe(
      compileBuilding(first.source).package?.manifest.contentHash,
    );
  });

  it('converts declared millimeter geometry and elevations exactly to meters', () => {
    const imported = importAnnotatedDxf(oneSpaceDxf(4, 4000), {
      fileName: 'metric-test.dxf',
    });

    expect(imported.valid).toBe(true);
    expect(imported.detectedUnits).toBe('millimeters');
    expect(imported.source?.floors[0]).toMatchObject({ elevation: 0, clearHeight: 2 });
    expect(imported.source?.floors[0].outline).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]);
  });

  it('fails closed when units or accessibility policy are not explicit', () => {
    const missingUnits = importAnnotatedDxf(oneSpaceDxf(0, 4), {
      fileName: 'unitless.dxf',
    });
    const missingPolicy = importAnnotatedDxf(oneSpaceDxf(6, 4, 'true'), {
      fileName: 'unsafe-policy.dxf',
    });

    expect(missingUnits.source).toBeNull();
    expect(missingUnits.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported-or-missing-units', severity: 'error' }),
      ]),
    );
    expect(missingPolicy.source).toBeNull();
    expect(missingPolicy.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-space-entity', severity: 'error' }),
      ]),
    );
  });

  it('rejects unsupported VoiceGIS geometry instead of guessing', () => {
    const unsupported = fixture.replace('0\nLWPOLYLINE\n8\nVG$FLOOR', '0\nPOLYLINE\n8\nVG$FLOOR');
    const imported = importAnnotatedDxf(unsupported, { fileName: 'legacy-polyline.dxf' });

    expect(imported.valid).toBe(false);
    expect(imported.source).toBeNull();
    expect(imported.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-floor-entity' })]),
    );
  });
});

describe('DXF layer mapping profile v0', () => {
  it('inventories ordinary CAD layers without assigning semantics', () => {
    const inspected = inspectDxfLayers(unannotatedFixture);

    expect(inspected.valid).toBe(true);
    expect(inspected.detectedUnits).toBe('meters');
    expect(inspected.layers).toEqual([
      {
        name: 'A-ANNOTATION',
        entityCount: 1,
        entityTypes: ['TEXT'],
        closedLightweightPolylines: 0,
        selectableEntities: [],
      },
      {
        name: 'A-FLOOR-OUTLINE',
        entityCount: 1,
        entityTypes: ['LWPOLYLINE'],
        closedLightweightPolylines: 1,
        selectableEntities: [
          {
            key: 'lwpolyline:0,0;10,0;10,6;0,6',
            type: 'LWPOLYLINE',
            polygon: [
              [0, 0],
              [10, 0],
              [10, 6],
              [0, 6],
            ],
            area: 60,
            occurrenceCount: 1,
          },
        ],
      },
      {
        name: 'A-SPACE-ENTRY',
        entityCount: 1,
        entityTypes: ['LWPOLYLINE'],
        closedLightweightPolylines: 1,
        selectableEntities: [
          {
            key: 'lwpolyline:0,0;10,0;10,6;0,6',
            type: 'LWPOLYLINE',
            polygon: [
              [0, 0],
              [10, 0],
              [10, 6],
              [0, 6],
            ],
            area: 60,
            occurrenceCount: 1,
          },
        ],
      },
    ]);
  });

  it('maps explicitly selected floor and space layers through the existing compiler', () => {
    const mapped = applyDxfLayerMapping(unannotatedFixture, unannotatedProfile);

    expect(mapped.valid).toBe(true);
    expect(mapped.text).not.toBeNull();
    const imported = importAnnotatedDxf(mapped.text!, { fileName: 'unannotated-lobby-v0.dxf' });
    expect(imported.source).toMatchObject({
      building: { id: 'unannotated-lobby-v0', entrySpaceId: 'entry' },
      floors: [{ id: 'g' }],
      spaces: [{ id: 'entry', accessible: true }],
    });
    expect(compileBuilding(imported.source).report.valid).toBe(true);
  });

  it('keeps package identity stable when mapping order changes', () => {
    const first = applyDxfLayerMapping(unannotatedFixture, unannotatedProfile);
    const second = applyDxfLayerMapping(unannotatedFixture, {
      ...unannotatedProfile,
      mappings: [...unannotatedProfile.mappings].reverse(),
    });
    const firstSource = importAnnotatedDxf(first.text!, {
      fileName: 'unannotated-lobby-v0.dxf',
    }).source;
    const secondSource = importAnnotatedDxf(second.text!, {
      fileName: 'unannotated-lobby-v0.dxf',
    }).source;

    expect(secondSource).toEqual(firstSource);
    expect(compileBuilding(secondSource).package?.manifest.contentHash).toBe(
      compileBuilding(firstSource).package?.manifest.contentHash,
    );
  });

  it('maps one explicit LINE into a routable portal between two spaces', () => {
    const mapped = applyDxfLayerMapping(twoRoomFixture, twoRoomProfile);

    expect(mapped.valid).toBe(true);
    const imported = importAnnotatedDxf(mapped.text!, {
      fileName: 'unannotated-two-room-v0.dxf',
    });
    expect(imported.valid).toBe(true);
    expect(imported.source?.portals).toEqual([
      expect.objectContaining({
        id: 'entry-gallery-door',
        floorId: 'g',
        kind: 'door',
        connects: ['entry', 'gallery'],
        position: [4, 4],
        width: 1,
        accessible: true,
        restricted: false,
      }),
    ]);

    const compiled = compileBuilding(imported.source);
    expect(compiled.report.valid).toBe(true);
    expect(compiled.package?.routing.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'portal:entry-gallery-door', kind: 'portal' }),
      ]),
    );
    expect(
      compiled.package?.routing.edges.filter(
        (edge) => edge.sourceId === 'entry-gallery-door' && edge.kind === 'within-space',
      ),
    ).toHaveLength(2);
  });

  it('inventories and maps multiple room polygons from one shared CAD layer', () => {
    const inspected = inspectDxfLayers(sharedRoomsFixture);
    const roomLayer = inspected.layers.find((layer) => layer.name === 'A-ROOMS');

    expect(roomLayer).toMatchObject({
      entityCount: 2,
      entityTypes: ['LWPOLYLINE'],
      closedLightweightPolylines: 2,
    });
    expect(roomLayer?.selectableEntities).toEqual([
      expect.objectContaining({ key: entryPolygonKey, area: 32, occurrenceCount: 1 }),
      expect.objectContaining({ key: galleryPolygonKey, area: 64, occurrenceCount: 1 }),
    ]);

    const mapped = applyDxfLayerMapping(sharedRoomsFixture, sharedRoomsProfile);
    expect(mapped.valid).toBe(true);
    const imported = importAnnotatedDxf(mapped.text!, {
      fileName: 'unannotated-shared-rooms-v0.dxf',
    });
    expect(imported.valid).toBe(true);
    expect(imported.source?.spaces).toEqual([
      expect.objectContaining({
        id: 'entry',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 8],
          [0, 8],
        ],
      }),
      expect.objectContaining({
        id: 'gallery',
        polygon: [
          [4, 0],
          [12, 0],
          [12, 8],
          [4, 8],
        ],
      }),
    ]);
    expect(compileBuilding(imported.source).report.valid).toBe(true);
  });

  it('keeps individual polygon selection stable when entities and mappings are reordered', () => {
    const first = applyDxfLayerMapping(sharedRoomsFixture, sharedRoomsProfile);
    const second = applyDxfLayerMapping(reorderEntities(sharedRoomsFixture), {
      ...sharedRoomsProfile,
      mappings: [...sharedRoomsProfile.mappings].reverse(),
    });
    const firstSource = importAnnotatedDxf(first.text!, {
      fileName: 'unannotated-shared-rooms-v0.dxf',
    }).source;
    const secondSource = importAnnotatedDxf(second.text!, {
      fileName: 'unannotated-shared-rooms-v0.dxf',
    }).source;

    expect(secondSource).toEqual(firstSource);
    expect(compileBuilding(secondSource).package?.manifest.contentHash).toBe(
      compileBuilding(firstSource).package?.manifest.contentHash,
    );
  });

  it('inventories and maps multiple portal lines from one shared CAD layer', () => {
    const inspected = inspectDxfLayers(sharedDoorsFixture);
    const doorLayer = inspected.layers.find((layer) => layer.name === 'A-DOORS');

    expect(doorLayer).toMatchObject({
      entityCount: 2,
      entityTypes: ['LINE'],
      closedLightweightPolylines: 0,
    });
    expect(doorLayer?.selectableEntities).toEqual([
      {
        key: entryDoorKey,
        type: 'LINE',
        line: [
          [4, 3.5],
          [4, 4.5],
        ],
        length: 1,
        occurrenceCount: 1,
      },
      {
        key: archiveDoorKey,
        type: 'LINE',
        line: [
          [8, 3.5],
          [8, 4.5],
        ],
        length: 1,
        occurrenceCount: 1,
      },
    ]);

    const mapped = applyDxfLayerMapping(sharedDoorsFixture, sharedDoorsProfile);
    expect(mapped.valid).toBe(true);
    const imported = importAnnotatedDxf(mapped.text!, {
      fileName: 'unannotated-shared-doors-v0.dxf',
    });
    expect(imported.valid).toBe(true);
    expect(imported.source?.portals).toEqual([
      expect.objectContaining({ id: 'entry-gallery-door', position: [4, 4], width: 1 }),
      expect.objectContaining({ id: 'gallery-archive-door', position: [8, 4], width: 1 }),
    ]);
    const compiled = compileBuilding(imported.source);
    expect(compiled.report.valid).toBe(true);
    expect(compiled.package?.routing.nodes.filter((node) => node.kind === 'portal')).toHaveLength(
      2,
    );
  });

  it('keeps portal-line selection stable across endpoint, entity, and mapping order', () => {
    const reversedEndpoints = sharedDoorsFixture.replace(
      '0\nLINE\n8\nA-DOORS\n10\n4\n20\n3.5\n11\n4\n21\n4.5',
      '0\nLINE\n8\nA-DOORS\n10\n4\n20\n4.5\n11\n4\n21\n3.5',
    );
    const first = applyDxfLayerMapping(sharedDoorsFixture, sharedDoorsProfile);
    const second = applyDxfLayerMapping(reorderEntities(reversedEndpoints), {
      ...sharedDoorsProfile,
      mappings: [...sharedDoorsProfile.mappings].reverse(),
    });
    const firstSource = importAnnotatedDxf(first.text!, {
      fileName: 'unannotated-shared-doors-v0.dxf',
    }).source;
    const secondSource = importAnnotatedDxf(second.text!, {
      fileName: 'unannotated-shared-doors-v0.dxf',
    }).source;

    expect(secondSource).toEqual(firstSource);
    expect(compileBuilding(secondSource).package?.manifest.contentHash).toBe(
      compileBuilding(firstSource).package?.manifest.contentHash,
    );
  });

  it('rejects ambiguous portal lines and entity-role mismatches', () => {
    const duplicateDoorGeometry = sharedDoorsFixture.replace(
      '10\n8\n20\n3.5\n11\n8\n21\n4.5',
      '10\n4\n20\n3.5\n11\n4\n21\n4.5',
    );
    const ambiguous = applyDxfLayerMapping(duplicateDoorGeometry, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-DOORS',
          sourceEntityKey: entryDoorKey,
          targetLayer: 'VG$PORTAL$g$door$door$entry$gallery$true$false',
        },
      ],
    });
    const wrongRole = applyDxfLayerMapping(sharedDoorsFixture, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-DOORS',
          sourceEntityKey: entryDoorKey,
          targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
        },
      ],
    });

    expect(ambiguous.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ambiguous-source-entity' })]),
    );
    expect(wrongRole.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'source-entity-type-mismatch' })]),
    );
    expect(ambiguous.text).toBeNull();
    expect(wrongRole.text).toBeNull();
  });

  it('inventories and maps multiple POI points from one shared CAD layer', () => {
    const inspected = inspectDxfLayers(sharedPoisFixture);
    const poiLayer = inspected.layers.find((layer) => layer.name === 'A-POIS');

    expect(poiLayer).toMatchObject({
      entityCount: 2,
      entityTypes: ['POINT'],
      closedLightweightPolylines: 0,
    });
    expect(poiLayer?.selectableEntities).toEqual([
      {
        key: receptionPointKey,
        type: 'POINT',
        point: [1.5, 4],
        occurrenceCount: 1,
      },
      {
        key: exhibitPointKey,
        type: 'POINT',
        point: [6, 4],
        occurrenceCount: 1,
      },
    ]);

    const mapped = applyDxfLayerMapping(sharedPoisFixture, sharedPoisProfile);
    expect(mapped.valid).toBe(true);
    const imported = importAnnotatedDxf(mapped.text!, {
      fileName: 'unannotated-shared-pois-v0.dxf',
    });
    expect(imported.valid).toBe(true);
    expect(imported.source?.pois).toEqual([
      expect.objectContaining({
        id: 'featured-exhibit',
        floorId: 'g',
        spaceId: 'gallery',
        position: [6, 4],
      }),
      expect.objectContaining({
        id: 'reception',
        floorId: 'g',
        spaceId: 'entry',
        position: [1.5, 4],
      }),
    ]);
    const compiled = compileBuilding(imported.source);
    expect(compiled.report.valid).toBe(true);
    expect(compiled.package?.routing.nodes.filter((node) => node.kind === 'poi')).toHaveLength(2);
  });

  it('keeps POI-point selection stable across entity and mapping order', () => {
    const first = applyDxfLayerMapping(sharedPoisFixture, sharedPoisProfile);
    const second = applyDxfLayerMapping(reorderEntities(sharedPoisFixture), {
      ...sharedPoisProfile,
      mappings: [...sharedPoisProfile.mappings].reverse(),
    });
    const firstSource = importAnnotatedDxf(first.text!, {
      fileName: 'unannotated-shared-pois-v0.dxf',
    }).source;
    const secondSource = importAnnotatedDxf(second.text!, {
      fileName: 'unannotated-shared-pois-v0.dxf',
    }).source;

    expect(secondSource).toEqual(firstSource);
    expect(compileBuilding(secondSource).package?.manifest.contentHash).toBe(
      compileBuilding(firstSource).package?.manifest.contentHash,
    );
  });

  it('rejects ambiguous POI points and point-role mismatches', () => {
    const duplicatePointGeometry = sharedPoisFixture.replace(
      '10\n6\n20\n4\n30\n0',
      '10\n1.5\n20\n4\n30\n0',
    );
    const ambiguous = applyDxfLayerMapping(duplicatePointGeometry, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-POIS',
          sourceEntityKey: receptionPointKey,
          targetLayer: 'VG$POI$g$entry$reception$service$true$true$Reception',
        },
      ],
    });
    const wrongRole = applyDxfLayerMapping(sharedPoisFixture, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-POIS',
          sourceEntityKey: receptionPointKey,
          targetLayer: 'VG$PORTAL$g$door$door$entry$gallery$true$false',
        },
      ],
    });

    expect(ambiguous.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ambiguous-source-entity' })]),
    );
    expect(wrongRole.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'source-entity-type-mismatch' })]),
    );
    expect(ambiguous.text).toBeNull();
    expect(wrongRole.text).toBeNull();
  });

  it('inventories and groups multiple connector stops from one shared CAD layer', () => {
    const inspected = inspectDxfLayers(sharedConnectorStopsFixture);
    const connectorLayer = inspected.layers.find((layer) => layer.name === 'A-RAMP-STOPS');

    expect(connectorLayer).toMatchObject({
      entityCount: 2,
      entityTypes: ['POINT'],
      closedLightweightPolylines: 0,
    });
    expect(connectorLayer?.selectableEntities).toEqual([
      {
        key: groundRampPointKey,
        type: 'POINT',
        point: [4, 4],
        occurrenceCount: 1,
      },
      {
        key: levelOneRampPointKey,
        type: 'POINT',
        point: [4.2, 4],
        occurrenceCount: 1,
      },
    ]);

    const mapped = applyDxfLayerMapping(sharedConnectorStopsFixture, sharedConnectorStopsProfile);
    expect(mapped.valid).toBe(true);
    const imported = importAnnotatedDxf(mapped.text!, {
      fileName: 'unannotated-shared-connector-stops-v0.dxf',
    });
    expect(imported.valid).toBe(true);
    expect(imported.source?.verticalConnectors).toEqual([
      {
        id: 'east-ramp',
        name: 'East Ramp',
        kind: 'ramp',
        accessible: true,
        restricted: false,
        stops: [
          { floorId: 'g', spaceId: 'entry', position: [4, 4] },
          { floorId: 'l1', spaceId: 'gallery', position: [4.2, 4] },
        ],
      },
    ]);
    const compiled = compileBuilding(imported.source);
    expect(compiled.report.valid).toBe(true);
    expect(
      compiled.package?.routing.nodes.filter((node) => node.kind === 'connector-stop'),
    ).toHaveLength(2);
  });

  it('keeps connector-stop grouping stable across entity and mapping order', () => {
    const first = applyDxfLayerMapping(sharedConnectorStopsFixture, sharedConnectorStopsProfile);
    const second = applyDxfLayerMapping(reorderEntities(sharedConnectorStopsFixture), {
      ...sharedConnectorStopsProfile,
      mappings: [...sharedConnectorStopsProfile.mappings].reverse(),
    });
    const firstSource = importAnnotatedDxf(first.text!, {
      fileName: 'unannotated-shared-connector-stops-v0.dxf',
    }).source;
    const secondSource = importAnnotatedDxf(second.text!, {
      fileName: 'unannotated-shared-connector-stops-v0.dxf',
    }).source;

    expect(secondSource).toEqual(firstSource);
    expect(compileBuilding(secondSource).package?.manifest.contentHash).toBe(
      compileBuilding(firstSource).package?.manifest.contentHash,
    );
  });

  it('rejects non-point connector-stop selections', () => {
    const mapped = applyDxfLayerMapping(sharedConnectorStopsFixture, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-FLOOR-G',
          sourceEntityKey: 'lwpolyline:0,0;8,0;8,8;0,8',
          targetLayer: 'VG$CONNECTOR$east-ramp$ramp$true$false$g$entry$East%20Ramp',
        },
      ],
    });

    expect(mapped.valid).toBe(false);
    expect(mapped.text).toBeNull();
    expect(mapped.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'source-entity-type-mismatch' })]),
    );
  });

  it('rejects unknown and ambiguous geometry selectors instead of guessing', () => {
    const unknown = applyDxfLayerMapping(sharedRoomsFixture, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-ROOMS',
          sourceEntityKey: 'lwpolyline:missing',
          targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
        },
      ],
    });
    const duplicateEntryGeometry = sharedRoomsFixture.replace(
      '10\n4\n20\n0\n10\n12\n20\n0\n10\n12\n20\n8\n10\n4\n20\n8',
      '10\n0\n20\n0\n10\n4\n20\n0\n10\n4\n20\n8\n10\n0\n20\n8',
    );
    const ambiguous = applyDxfLayerMapping(duplicateEntryGeometry, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-ROOMS',
          sourceEntityKey: entryPolygonKey,
          targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
        },
      ],
    });

    expect(unknown.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-entity' })]),
    );
    expect(ambiguous.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ambiguous-source-entity' })]),
    );
    expect(unknown.text).toBeNull();
    expect(ambiguous.text).toBeNull();
  });

  it('rejects a portal mapping unless its layer contains exactly one LINE', () => {
    const mapped = applyDxfLayerMapping(unannotatedFixture, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-FLOOR-OUTLINE',
          targetLayer: 'VG$PORTAL$g$p1$opening$a$b$true$false',
        },
      ],
    });

    expect(mapped.valid).toBe(false);
    expect(mapped.text).toBeNull();
    expect(mapped.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'layer-not-single-line' })]),
    );
  });

  it('rejects unsupported semantic roles before rewriting the drawing', () => {
    const mapped = applyDxfLayerMapping(unannotatedFixture, {
      profileVersion: DXF_LAYER_MAPPING_PROFILE_VERSION,
      mappings: [
        {
          sourceLayer: 'A-FLOOR-OUTLINE',
          targetLayer: 'VG$ANCHOR$g$entry$a1$qr$0$payload',
        },
      ],
    });

    expect(mapped.valid).toBe(false);
    expect(mapped.text).toBeNull();
    expect(mapped.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported-mapping-role' })]),
    );
  });
});
