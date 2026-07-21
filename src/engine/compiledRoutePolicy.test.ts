import { describe, expect, it } from 'vitest';
import liftClosureJson from '../../buildings/reference-medical-centre/operations/lift-closed.overlay.json';
import { BUILDING_PACKAGE } from '../data/compiledBuilding';
import { calculateCompiledRoute } from './compiledRoutePolicy';
import type { OperationalOverlay } from './operationalOverlay';

const liftClosure = liftClosureJson as OperationalOverlay;
const evaluatedAt = '2026-07-22T12:00:00.000Z';

describe('compiled route policy and receipts', () => {
  it('attaches package, profile, and connector evidence to a route', () => {
    const result = calculateCompiledRoute('poi:main-entrance', 'poi:cardiology', {
      profile: 'wheelchair',
    });

    expect(result.found).toBe(true);
    expect(result.receipt).toMatchObject({
      status: 'routed',
      packageHash: BUILDING_PACKAGE.manifest.contentHash,
      profile: 'wheelchair',
      operationalOverlayId: null,
    });
    expect(result.receipt.selectedConnectors).toEqual([
      {
        sourceId: 'lift-east',
        kind: 'elevator',
        fromFloorId: 'g',
        toFloorId: 'l1',
      },
    ]);
  });

  it('reroutes a standard profile to stairs when the lift closes', () => {
    const result = calculateCompiledRoute('poi:main-entrance', 'poi:cardiology', {
      profile: 'standard',
      operationalOverlay: liftClosure,
      evaluatedAt,
    });

    expect(result.found).toBe(true);
    expect(result.receipt.appliedClosureIds).toEqual(['close-east-lift']);
    expect(result.receipt.excludedEdges.closed).toBeGreaterThan(0);
    expect(result.receipt.selectedConnectors.map((connector) => connector.sourceId)).toEqual([
      'stairs-east',
    ]);
  });

  it('reports no compliant cross-floor route when the accessible lift closes', () => {
    const result = calculateCompiledRoute('poi:main-entrance', 'poi:cardiology', {
      profile: 'wheelchair',
      operationalOverlay: liftClosure,
      evaluatedAt,
    });

    expect(result.found).toBe(false);
    expect(result.receipt.status).toBe('unroutable');
    expect(result.receipt.selectedConnectors).toEqual([]);
  });

  it('rejects an overlay without an explicit deterministic evaluation time', () => {
    const result = calculateCompiledRoute('poi:main-entrance', 'poi:cardiology', {
      operationalOverlay: liftClosure,
    });

    expect(result.found).toBe(false);
    expect(result.receipt.status).toBe('rejected');
    expect(result.receipt.overlayIssues.map((issue) => issue.code)).toContain('invalid-time');
  });
});
