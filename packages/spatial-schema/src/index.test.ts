import { describe, expect, it } from 'vitest';
import example from '../examples/minimal-two-floor.json';
import {
  SPATIAL_SCHEMA_VERSION,
  assertBuildingSourceShape,
  isBuildingSource,
  validateBuildingSourceShape,
} from './index';

describe('indoor building source schema', () => {
  it('accepts the versioned two-floor example', () => {
    expect(isBuildingSource(example)).toBe(true);
    expect(example.schemaVersion).toBe(SPATIAL_SCHEMA_VERSION);
    expect(() => assertBuildingSourceShape(example)).not.toThrow();
  });

  it('rejects unknown properties instead of silently discarding them', () => {
    const invalid = structuredClone(example) as Record<string, unknown>;
    invalid.unreviewedMetadata = { claimedAccuracy: 'perfect' };

    const result = validateBuildingSourceShape(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects malformed coordinates and unsupported schema versions', () => {
    const invalid = structuredClone(example);
    invalid.schemaVersion = '0.2.0';
    invalid.floors[0].outline[0] = [0, 0, 4];

    const result = validateBuildingSourceShape(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.instancePath)).toEqual(
      expect.arrayContaining(['/schemaVersion', '/floors/0/outline/0']),
    );
  });
});
