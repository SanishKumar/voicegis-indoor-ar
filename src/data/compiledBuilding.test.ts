import { describe, expect, it } from 'vitest';
import {
  BUILDING_PACKAGE,
  ROUTING_EDGES,
  ROUTING_NODES,
  getDefaultStartNodeId,
  getNodeById,
  getPOIs,
} from './compiledBuilding';

describe('compiled building visitor adapter', () => {
  it('preserves the compiler graph without generating parallel IDs', () => {
    expect(ROUTING_NODES).toHaveLength(BUILDING_PACKAGE.routing.nodes.length);
    expect(ROUTING_EDGES).toHaveLength(BUILDING_PACKAGE.routing.edges.length);
    expect(new Set(ROUTING_NODES.map((node) => node.id)).size).toBe(ROUTING_NODES.length);
  });

  it('maps every edge to valid endpoints and meter distances', () => {
    const nodeIds = new Set(ROUTING_NODES.map((node) => node.id));
    expect(
      ROUTING_EDGES.every(
        (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.distance > 0,
      ),
    ).toBe(true);
  });

  it('hides staff-only destinations from the visitor catalogue by default', () => {
    const publicPois = getPOIs();
    const allPois = getPOIs({ includeRestricted: true });

    expect(publicPois.every((node) => node.poi.public)).toBe(true);
    expect(publicPois.some((node) => node.poi.sourceId === 'records-store')).toBe(false);
    expect(allPois.some((node) => node.poi.sourceId === 'records-store')).toBe(true);
  });

  it('derives the default check-in point from the declared entry space', () => {
    const startId = getDefaultStartNodeId();
    const start = getNodeById(startId);

    expect(start?.poi?.name).toBe('Main Entrance');
    expect(start?.floor).toBe('g');
  });

  it('retains accessibility and restriction policy on graph edges', () => {
    expect(ROUTING_EDGES.some((edge) => edge.accessible === false)).toBe(true);
    expect(ROUTING_EDGES.some((edge) => edge.restricted === true)).toBe(true);
    expect(ROUTING_EDGES.filter((edge) => edge.kind === 'vertical-connector')).toHaveLength(2);
  });
});
