import { describe, expect, it } from 'vitest';
import liftClosureJson from '../../buildings/reference-medical-centre/operations/lift-closed.overlay.json';
import { BUILDING_PACKAGE } from '../data/compiledBuilding';
import { resolveOperationalOverlay, type OperationalOverlay } from './operationalOverlay';

const liftClosure = liftClosureJson as OperationalOverlay;
const evaluatedAt = '2026-07-22T12:00:00.000Z';

describe('operational overlay resolution', () => {
  it('resolves a connector-source closure to every compiled edge from that source', () => {
    const result = resolveOperationalOverlay(liftClosure, BUILDING_PACKAGE, evaluatedAt);
    const expectedEdgeIds = BUILDING_PACKAGE.routing.edges
      .filter((edge) => edge.sourceId === 'lift-east')
      .map((edge) => edge.id)
      .sort();

    expect(result.valid).toBe(true);
    expect(result.activeClosureIds).toEqual(['close-east-lift']);
    expect(result.closedEdgeIds).toEqual(expectedEdgeIds);
  });

  it('rejects unknown targets instead of silently dropping them', () => {
    const invalid: OperationalOverlay = structuredClone(liftClosure);
    invalid.closures[0].target.id = 'missing-lift';

    const result = resolveOperationalOverlay(invalid, BUILDING_PACKAGE, evaluatedAt);
    expect(result.valid).toBe(false);
    expect(result.closedEdgeIds).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain('unknown-target');
  });

  it('rejects expired overlays at an explicit evaluation time', () => {
    const result = resolveOperationalOverlay(
      liftClosure,
      BUILDING_PACKAGE,
      '2026-08-01T00:00:00.000Z',
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('overlay-expired');
  });

  it('rejects malformed external data before semantic resolution', () => {
    const result = resolveOperationalOverlay(
      { id: 'malformed', closures: [{ target: null }] },
      BUILDING_PACKAGE,
      evaluatedAt,
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'invalid-shape' })]);
  });
});
