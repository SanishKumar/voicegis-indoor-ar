import { describe, expect, it } from 'vitest';
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
});
