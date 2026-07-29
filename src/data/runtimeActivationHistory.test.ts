import { describe, expect, it } from 'vitest';
import { ASTERION_PACKAGE, HARBOR_PACKAGE } from '../test/venueFixtures';
import {
  consumeRuntimeRollback,
  createRuntimeActivationHistory,
  recordRuntimeActivation,
  summarizeRuntimePackage,
} from './runtimeActivationHistory';

describe('controlled runtime activation history', () => {
  it('retains exactly one previous verified package', () => {
    const initial = recordRuntimeActivation(createRuntimeActivationHistory(), {
      buildingPackage: ASTERION_PACKAGE,
      source: '/venues/asterion/building.package.json',
    });
    const switched = recordRuntimeActivation(initial, {
      buildingPackage: HARBOR_PACKAGE,
      source: 'studio:harbor-preview',
    });

    expect(switched.active?.buildingPackage).toBe(HARBOR_PACKAGE);
    expect(switched.rollback?.buildingPackage).toBe(ASTERION_PACKAGE);
    expect(summarizeRuntimePackage(switched.rollback)).toEqual({
      buildingId: ASTERION_PACKAGE.building.id,
      buildingName: ASTERION_PACKAGE.building.name,
      contentHash: ASTERION_PACKAGE.manifest.contentHash,
      source: '/venues/asterion/building.package.json',
    });
  });

  it('consumes rollback instead of building an unbounded history', () => {
    const first = recordRuntimeActivation(createRuntimeActivationHistory(), {
      buildingPackage: ASTERION_PACKAGE,
      source: 'catalog:asterion',
    });
    const second = recordRuntimeActivation(first, {
      buildingPackage: HARBOR_PACKAGE,
      source: 'studio:harbor-preview',
    });
    const rolledBack = consumeRuntimeRollback(second);

    expect(rolledBack.active?.buildingPackage).toBe(ASTERION_PACKAGE);
    expect(rolledBack.rollback).toBeNull();
  });

  it('does not replace rollback state when the active hash is reactivated', () => {
    const first = recordRuntimeActivation(createRuntimeActivationHistory(), {
      buildingPackage: ASTERION_PACKAGE,
      source: 'catalog:asterion',
    });
    const second = recordRuntimeActivation(first, {
      buildingPackage: HARBOR_PACKAGE,
      source: 'studio:harbor-preview',
    });
    const duplicate = recordRuntimeActivation(second, {
      buildingPackage: HARBOR_PACKAGE,
      source: 'file:duplicate.json',
    });

    expect(duplicate).toBe(second);
    expect(duplicate.rollback?.buildingPackage).toBe(ASTERION_PACKAGE);
  });

  it('rejects rollback when no previous package exists', () => {
    expect(() => consumeRuntimeRollback(createRuntimeActivationHistory())).toThrow(
      'No previous runtime package is available.',
    );
  });
});
