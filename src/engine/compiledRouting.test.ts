import { describe, expect, it } from 'vitest';
import { ROUTING_EDGES, ROUTING_NODES } from '../data/compiledBuilding';
import { STEP_TYPE, calculateRoute } from './routingCore';

function edgeKey(a: string, b: string) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

const edgesByPair = new Map(
  ROUTING_EDGES.map((edge) => [edgeKey(edge.from, edge.to), edge] as const),
);

describe('compiled package routing', () => {
  it('routes between floors through the accessible lift when requested', () => {
    const result = calculateRoute(
      'poi:main-entrance',
      'poi:cardiology',
      ROUTING_NODES,
      ROUTING_EDGES,
      { accessibleOnly: true },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.path.map((node) => node.floor)).toContain('g');
    expect(result.path.map((node) => node.floor)).toContain('l1');
    expect(result.steps.some((step) => step.type === STEP_TYPE.ELEVATOR)).toBe(true);
    expect(result.steps.some((step) => step.type === STEP_TYPE.STAIRS)).toBe(false);
    expect(result.steps.reduce((total, step) => total + step.distance, 0)).toBeCloseTo(
      result.totalDistance,
      6,
    );
  });

  it('does not traverse restricted edges for public navigation', () => {
    const result = calculateRoute(
      'poi:main-entrance',
      'poi:training-room',
      ROUTING_NODES,
      ROUTING_EDGES,
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    const routeEdges = result.pathIds
      .slice(0, -1)
      .map((from, index) => edgesByPair.get(edgeKey(from, result.pathIds[index + 1])));
    expect(routeEdges.every((edge) => edge && !edge.restricted)).toBe(true);
  });

  it('requires an explicit policy override for a staff-only destination', () => {
    const denied = calculateRoute(
      'poi:main-entrance',
      'poi:records-store',
      ROUTING_NODES,
      ROUTING_EDGES,
    );
    const allowed = calculateRoute(
      'poi:main-entrance',
      'poi:records-store',
      ROUTING_NODES,
      ROUTING_EDGES,
      { allowRestricted: true },
    );

    expect(denied.found).toBe(false);
    expect(allowed.found).toBe(true);
  });
});
