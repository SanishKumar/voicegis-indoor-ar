import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileBuilding } from '@voicegis/map-compiler';
import { importAnnotatedDxf } from './index';

const fixtureUrl = new URL('../../../buildings/import-fixtures/atrium-dxf-v0.dxf', import.meta.url);
const fixture = readFileSync(fixtureUrl, 'utf8');

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
