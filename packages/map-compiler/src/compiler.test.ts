import { describe, expect, it } from 'vitest';
import asterion from '../../../buildings/asterion-medical-center/source/building.json';
import example from '../../spatial-schema/examples/minimal-two-floor.json';
import { compileBuilding, stableJson } from './compiler';

describe('indoor map compiler', () => {
  it('compiles a deterministic multi-floor package', () => {
    const first = compileBuilding(example);
    const second = compileBuilding(structuredClone(example));

    expect(first.report).toMatchObject({ valid: true, summary: { errors: 0 } });
    expect(first.package).not.toBeNull();
    expect(first.package?.manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stableJson(first.package)).toBe(stableJson(second.package));
    expect(first.package?.routing.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'vertical-connector',
          connectorKind: 'elevator',
          accessible: true,
        }),
      ]),
    );
  });

  it('rejects semantically misaligned elevator stops', () => {
    const invalid = structuredClone(example);
    invalid.verticalConnectors[0].stops[1].position = [8, 4];
    const result = compileBuilding(invalid);

    expect(result.package).toBeNull();
    expect(result.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'misaligned-elevator' })]),
    );
  });

  it('rejects globally duplicated semantic identifiers', () => {
    const invalid = structuredClone(example);
    invalid.pois[0].id = invalid.spaces[0].id;
    const result = compileBuilding(invalid);

    expect(result.package).toBeNull();
    expect(result.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'duplicate-id' })]),
    );
  });

  it('returns schema errors without entering semantic compilation', () => {
    const invalid = structuredClone(example) as Record<string, unknown>;
    invalid.schemaVersion = '99.0.0';
    const result = compileBuilding(invalid);

    expect(result.package).toBeNull();
    expect(result.report.valid).toBe(false);
    expect(result.report.issues[0].code).toBe('schema-const');
  });

  it('builds an ordered corridor centreline instead of a centroid star', () => {
    const result = compileBuilding(asterion);
    const routing = result.package?.routing;

    expect(result.report.valid).toBe(true);
    expect(routing).toBeDefined();
    if (!routing) return;

    const arrivalProjection = routing.nodes.find(
      (node) =>
        node.kind === 'waypoint' &&
        node.sourceId === 'g-concourse' &&
        node.position[0] === 8 &&
        node.position[1] === 24,
    );
    const emergencyProjection = routing.nodes.find(
      (node) =>
        node.kind === 'waypoint' &&
        node.sourceId === 'g-concourse' &&
        node.position[0] === 13 &&
        node.position[1] === 24,
    );
    const edgeBetween = (from: string, to: string) =>
      routing.edges.find(
        (edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
      );

    expect(arrivalProjection).toBeDefined();
    expect(emergencyProjection).toBeDefined();
    if (!arrivalProjection || !emergencyProjection) return;

    expect(edgeBetween('portal:p-g-arrival', arrivalProjection.id)?.distanceMeters).toBe(0.01);
    expect(edgeBetween(arrivalProjection.id, emergencyProjection.id)?.distanceMeters).toBe(5);
    expect(edgeBetween(emergencyProjection.id, 'portal:p-g-emergency')?.distanceMeters).toBe(4);
    expect(edgeBetween('portal:p-g-arrival', 'space:g-concourse')).toBeUndefined();
  });

  describe('a venue with grounds', () => {
    const site = {
      floorId: 'g',
      buildings: [
        {
          id: 'only-building',
          name: 'Only Building',
          footprint: [
            [1, 1],
            [11, 1],
            [11, 7],
            [1, 7],
          ],
          storeys: 2,
        },
      ],
      grounds: [
        {
          id: 'front-lawn',
          kind: 'lawn',
          polygon: [
            [0, 0],
            [12, 0],
            [12, 1],
            [0, 1],
          ],
        },
      ],
      features: [{ id: 'oak', kind: 'tree', position: [6, 0.5] }],
    };

    it('carries the site through to the package and covers it with the hash', () => {
      const plain = compileBuilding(example);
      const withSite = compileBuilding({ ...structuredClone(example), site });

      expect(withSite.report).toMatchObject({ valid: true, summary: { errors: 0 } });
      expect(withSite.package?.site).toEqual(site);
      expect(withSite.package?.manifest.contentHash).not.toBe(plain.package?.manifest.contentHash);
      // The picture is not the map: the same rooms and doors route the same way.
      expect(withSite.package?.routing).toEqual(plain.package?.routing);
    });

    it('leaves a venue without one exactly as it was', () => {
      const result = compileBuilding(example);
      expect(result.package).not.toBeNull();
      expect(Object.keys(result.package!)).not.toContain('site');
    });

    it('refuses grounds drawn outside the floor they stand on', () => {
      const adrift = structuredClone(site);
      adrift.grounds[0].polygon = [
        [0, 0],
        [40, 0],
        [40, 1],
        [0, 1],
      ];
      adrift.features[0].position = [6, -5];
      const result = compileBuilding({ ...structuredClone(example), site: adrift });

      expect(result.package).toBeNull();
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'site-shape-outside-floor' }),
          expect.objectContaining({ code: 'site-feature-outside-floor' }),
        ]),
      );
    });

    it('refuses a site on a floor that does not exist, and an unknown kind of ground', () => {
      const lost = compileBuilding({
        ...structuredClone(example),
        site: { ...structuredClone(site), floorId: 'basement' },
      });
      expect(lost.report.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'unknown-floor' })]),
      );

      const lava = structuredClone(site) as { grounds: Array<{ kind: string }> };
      lava.grounds[0].kind = 'lava';
      const invalid = compileBuilding({ ...structuredClone(example), site: lava });
      expect(invalid.package).toBeNull();
      expect(invalid.report.issues[0].code).toBe('schema-enum');
    });

    it('counts site identifiers with every other identifier in the venue', () => {
      const clash = structuredClone(site);
      clash.features[0].id = example.spaces[0].id;
      const result = compileBuilding({ ...structuredClone(example), site: clash });
      expect(result.report.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'duplicate-id' })]),
      );
    });
  });
});
