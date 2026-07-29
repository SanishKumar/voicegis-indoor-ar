import { describe, expect, it } from 'vitest';
import example from '../../spatial-schema/examples/minimal-two-floor.json';
import { compileBuilding } from './compiler';
import { compileBuildingInBrowser } from './browser';
import { stableJson } from './compilerCore';

describe('browser compiler adapter', () => {
  it('produces the exact package and hash emitted by the Node compiler', async () => {
    const nodeResult = compileBuilding(example);
    const browserResult = await compileBuildingInBrowser(structuredClone(example));

    expect(browserResult.report).toEqual(nodeResult.report);
    expect(browserResult.package?.manifest.contentHash).toBe(
      nodeResult.package?.manifest.contentHash,
    );
    expect(stableJson(browserResult.package)).toBe(stableJson(nodeResult.package));
  });

  it('preserves fail-closed validation without hashing invalid input', async () => {
    const invalid = structuredClone(example);
    invalid.pois[0].id = invalid.spaces[0].id;
    const result = await compileBuildingInBrowser(invalid);

    expect(result.package).toBeNull();
    expect(result.report.valid).toBe(false);
    expect(result.report.issues.length).toBeGreaterThan(0);
  });
});
