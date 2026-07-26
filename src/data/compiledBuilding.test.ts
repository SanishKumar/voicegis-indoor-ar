import { describe, expect, it } from 'vitest';
import { ASTERION_PACKAGE, ASTERION_RUNTIME } from '../test/venueFixtures';

describe('compiled building visitor adapter', () => {
  it('preserves the compiler graph without generating parallel IDs', () => {
    expect(ASTERION_PACKAGE.floors).toHaveLength(4);
    expect(ASTERION_PACKAGE.spaces).toHaveLength(60);
    expect(ASTERION_RUNTIME.routingNodes).toHaveLength(ASTERION_PACKAGE.routing.nodes.length);
    expect(ASTERION_RUNTIME.routingEdges).toHaveLength(ASTERION_PACKAGE.routing.edges.length);
    expect(new Set(ASTERION_RUNTIME.routingNodes.map((node) => node.id)).size).toBe(
      ASTERION_RUNTIME.routingNodes.length,
    );
  });

  it('maps every edge to valid endpoints and meter distances', () => {
    const nodeIds = new Set(ASTERION_RUNTIME.routingNodes.map((node) => node.id));
    expect(
      ASTERION_RUNTIME.routingEdges.every(
        (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.distance > 0,
      ),
    ).toBe(true);
  });

  it('hides staff-only destinations from the visitor catalogue by default', () => {
    const publicPois = ASTERION_RUNTIME.getPOIs();
    const allPois = ASTERION_RUNTIME.getPOIs({ includeRestricted: true });

    expect(publicPois.every((node) => node.poi.public)).toBe(true);
    expect(publicPois.some((node) => node.poi.sourceId === 'poi-data-center')).toBe(false);
    expect(allPois.some((node) => node.poi.sourceId === 'poi-data-center')).toBe(true);
  });

  it('derives the default check-in point from the declared entry space', () => {
    const startId = ASTERION_RUNTIME.getDefaultStartNodeId();
    const start = ASTERION_RUNTIME.getNodeById(startId);

    expect(start?.poi?.name).toBe('Civic Plaza Entrance');
    expect(start?.floor).toBe('g');
  });

  it('retains accessibility and restriction policy on graph edges', () => {
    expect(ASTERION_RUNTIME.routingEdges.some((edge) => edge.accessible === false)).toBe(true);
    expect(ASTERION_RUNTIME.routingEdges.some((edge) => edge.restricted === true)).toBe(true);
    expect(
      ASTERION_RUNTIME.routingEdges.filter((edge) => edge.kind === 'vertical-connector'),
    ).toHaveLength(12);
  });
});
