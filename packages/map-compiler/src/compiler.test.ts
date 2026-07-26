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
        (edge) =>
          (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
      );

    expect(arrivalProjection).toBeDefined();
    expect(emergencyProjection).toBeDefined();
    if (!arrivalProjection || !emergencyProjection) return;

    expect(edgeBetween('portal:p-g-arrival', arrivalProjection.id)?.distanceMeters).toBe(0.01);
    expect(edgeBetween(arrivalProjection.id, emergencyProjection.id)?.distanceMeters).toBe(5);
    expect(edgeBetween(emergencyProjection.id, 'portal:p-g-emergency')?.distanceMeters).toBe(4);
    expect(edgeBetween('portal:p-g-arrival', 'space:g-concourse')).toBeUndefined();
  });
});
