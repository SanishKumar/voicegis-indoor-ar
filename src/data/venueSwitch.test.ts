import { describe, expect, it } from 'vitest';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { searchPOIs } from '../engine/searchIndex.js';
import {
  ASTERION_PACKAGE,
  ASTERION_RUNTIME,
  HARBOR_PACKAGE,
  HARBOR_RUNTIME,
} from '../test/venueFixtures';
import { createVenueScopedState } from './venueSession';

describe('runtime venue switching', () => {
  it('recreates all venue-scoped state and exposes only the new package data', () => {
    const asterionState = createVenueScopedState(ASTERION_RUNTIME);
    asterionState.navigation.destinationNodeId = 'poi:poi-cardiology';
    asterionState.navigation.route = { found: true, pathIds: ['poi:poi-cardiology'] };
    asterionState.navigation.selectedPOI = ASTERION_RUNTIME.getNodeById('poi:poi-cardiology');
    asterionState.operationalOverlay = { id: 'asterion-closure' };
    asterionState.localizationEstimate = {
      anchorId: ASTERION_PACKAGE.localizationAnchors[0].id,
    };

    const harborState = createVenueScopedState(HARBOR_RUNTIME);

    expect(harborState).toMatchObject({
      navigation: {
        venueKey: HARBOR_RUNTIME.key,
        destinationNodeId: null,
        route: null,
        selectedPOI: null,
        activeFloorId: 'g',
      },
      operationalOverlay: null,
      localizationEstimate: null,
    });
    expect(HARBOR_RUNTIME.getNodeById('poi:poi-cardiology')).toBeNull();
    expect(HARBOR_RUNTIME.buildingPackage.floors.map((floor) => floor.id)).toEqual(['g', 'm']);
    expect(HARBOR_RUNTIME.getPOIs().some((node) => node.poi.name === 'Waterfront Platform')).toBe(
      true,
    );
    expect(
      HARBOR_PACKAGE.localizationAnchors.some((anchor) =>
        anchor.id.startsWith('anchor-ferry-entry'),
      ),
    ).toBe(true);
    expect(
      HARBOR_PACKAGE.localizationAnchors.some((anchor) =>
        ASTERION_PACKAGE.localizationAnchors.some(
          (asterionAnchor) => asterionAnchor.id === anchor.id,
        ),
      ),
    ).toBe(false);
  });

  it('routes and searches against the active runtime after a switch', () => {
    const asterionResults = searchPOIs(ASTERION_RUNTIME.getPOIs(), 'cardiology') as {
      node: { poi: { name: string } };
    }[];
    const harborResults = searchPOIs(HARBOR_RUNTIME.getPOIs(), 'ferry platform') as {
      node: { poi: { name: string } };
    }[];
    expect(asterionResults[0]?.node.poi.name).toBe('Heart & Vascular Clinic');
    expect(searchPOIs(HARBOR_RUNTIME.getPOIs(), 'cardiology')).toEqual([]);
    expect(harborResults[0]?.node.poi.name).toBe('Waterfront Platform');

    const route = calculateCompiledRoute(
      HARBOR_RUNTIME,
      'poi:poi-ferry-entry',
      'poi:poi-overlook',
      { profile: 'wheelchair' },
    );
    expect(route.found).toBe(true);
    expect(route.receipt).toMatchObject({
      buildingId: 'harbor-exchange',
      packageHash: HARBOR_PACKAGE.manifest.contentHash,
      profile: 'wheelchair',
    });
    expect(route.receipt.selectedConnectors).toEqual([
      expect.objectContaining({ sourceId: 'lift-east', kind: 'elevator' }),
    ]);
  });
});
