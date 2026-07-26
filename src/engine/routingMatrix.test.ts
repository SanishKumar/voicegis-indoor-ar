import { describe, expect, it } from 'vitest';
import liftClosureJson from '../../buildings/asterion-medical-center/operations/all-public-lifts-closed.overlay.json';
import { getPOIs, ROUTING_EDGES } from '../data/compiledBuilding';
import { calculateCompiledRoute, type RoutingProfile } from './compiledRoutePolicy';
import type { OperationalOverlay } from './operationalOverlay';

const publicPois = getPOIs();
const liftClosure = liftClosureJson as OperationalOverlay;
const evaluatedAt = '2026-07-22T12:00:00.000Z';

function edgeKey(a: string, b: string) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

const edgesByPair = new Map(
  ROUTING_EDGES.map((edge) => [edgeKey(edge.from, edge.to), edge] as const),
);

function routeIssues(
  fromId: string,
  toId: string,
  profile: RoutingProfile,
  options: Parameters<typeof calculateCompiledRoute>[2] = {},
) {
  const result = calculateCompiledRoute(fromId, toId, { ...options, profile });
  if (!result.found) return [result.error];

  const issues: string[] = [];
  let edgeDistance = 0;
  for (let index = 0; index < result.pathIds.length - 1; index += 1) {
    const edge = edgesByPair.get(edgeKey(result.pathIds[index], result.pathIds[index + 1]));
    if (!edge) {
      issues.push(`missing edge at path index ${index}`);
      continue;
    }
    edgeDistance += edge.distance;
    if (edge.restricted) issues.push(`used restricted edge ${edge.id}`);
    if (profile === 'wheelchair' && edge.accessible === false) {
      issues.push(`used inaccessible edge ${edge.id}`);
    }
  }

  if (Math.abs(edgeDistance - result.totalDistance) > 1e-6) {
    issues.push(`edge distance ${edgeDistance} differs from route ${result.totalDistance}`);
  }
  if (result.steps.at(-1)?.type !== 'arrive') issues.push('missing arrival instruction');
  return issues;
}

describe('public destination route matrix', () => {
  it('routes every public POI pair symmetrically under standard and wheelchair policy', () => {
    const failures: string[] = [];
    let pairCount = 0;

    for (let fromIndex = 0; fromIndex < publicPois.length; fromIndex += 1) {
      for (let toIndex = fromIndex + 1; toIndex < publicPois.length; toIndex += 1) {
        pairCount += 1;
        const from = publicPois[fromIndex];
        const to = publicPois[toIndex];

        for (const profile of ['standard', 'wheelchair'] as const) {
          const forwardIssues = routeIssues(from.id, to.id, profile);
          const reverseIssues = routeIssues(to.id, from.id, profile);
          failures.push(
            ...forwardIssues.map((issue) => `${profile} ${from.id} -> ${to.id}: ${issue}`),
            ...reverseIssues.map((issue) => `${profile} ${to.id} -> ${from.id}: ${issue}`),
          );

          const forward = calculateCompiledRoute(from.id, to.id, { profile });
          const reverse = calculateCompiledRoute(to.id, from.id, { profile });
          if (
            forward.found &&
            reverse.found &&
            Math.abs(forward.totalDistance - reverse.totalDistance) > 1e-6
          ) {
            failures.push(`${profile} route is asymmetric for ${from.id} and ${to.id}`);
          }
        }
      }
    }

    expect(publicPois).toHaveLength(32);
    expect(pairCount).toBe(496);
    expect(failures).toEqual([]);
  });

  it('keeps same-floor routes available and fails cross-floor wheelchair routes during lift outage', () => {
    const failures: string[] = [];
    let sameFloorPairs = 0;
    let crossFloorPairs = 0;

    for (let fromIndex = 0; fromIndex < publicPois.length; fromIndex += 1) {
      for (let toIndex = fromIndex + 1; toIndex < publicPois.length; toIndex += 1) {
        const from = publicPois[fromIndex];
        const to = publicPois[toIndex];
        const options = { operationalOverlay: liftClosure, evaluatedAt };
        const sameFloor = String(from.floor) === String(to.floor);
        const standard = calculateCompiledRoute(from.id, to.id, {
          ...options,
          profile: 'standard',
        });
        const wheelchair = calculateCompiledRoute(from.id, to.id, {
          ...options,
          profile: 'wheelchair',
        });

        if (sameFloor) {
          sameFloorPairs += 1;
          failures.push(
            ...routeIssues(from.id, to.id, 'standard', options).map(
              (issue) => `same-floor standard ${from.id} -> ${to.id}: ${issue}`,
            ),
            ...routeIssues(from.id, to.id, 'wheelchair', options).map(
              (issue) => `same-floor wheelchair ${from.id} -> ${to.id}: ${issue}`,
            ),
          );
          continue;
        }

        crossFloorPairs += 1;
        if (!standard.found) {
          failures.push(`standard outage route failed for ${from.id} -> ${to.id}`);
        } else if (
          standard.receipt.selectedConnectors.some(
            (connector) => connector.kind === 'elevator',
          )
        ) {
          failures.push(`standard outage route used a lift for ${from.id} -> ${to.id}`);
        }
        if (wheelchair.found || wheelchair.receipt.status !== 'unroutable') {
          failures.push(`wheelchair outage route did not fail for ${from.id} -> ${to.id}`);
        }
      }
    }

    expect(sameFloorPairs).toBe(114);
    expect(crossFloorPairs).toBe(382);
    expect(failures).toEqual([]);
  });
});
