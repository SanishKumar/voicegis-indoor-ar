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
      },
      {
        name: 'A-FLOOR-OUTLINE',
        entityCount: 1,
        entityTypes: ['LWPOLYLINE'],
        closedLightweightPolylines: 1,
      },
      {
        name: 'A-SPACE-ENTRY',
        entityCount: 1,
        entityTypes: ['LWPOLYLINE'],
        closedLightweightPolylines: 1,
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

  it('rejects unsupported semantic roles before rewriting the drawing', () => {
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
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported-mapping-role' })]),
    );
  });
});
