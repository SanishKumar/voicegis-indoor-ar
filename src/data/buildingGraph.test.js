import { describe, expect, it } from 'vitest';
import { BUILDING_CONFIG } from './buildingConfig.js';
import { EDGES, NODES, buildAdjacencyList, getPOIs } from './buildingGraph.js';

describe('prototype building graph', () => {
  it('uses unique node identifiers and valid edge endpoints', () => {
    const nodeIds = NODES.map((node) => node.id);
    const knownNodes = new Set(nodeIds);

    expect(knownNodes.size).toBe(nodeIds.length);
    expect(knownNodes.has(BUILDING_CONFIG.defaultStartNode)).toBe(true);

    for (const edge of EDGES) {
      expect(knownNodes.has(edge.from), `Unknown edge origin: ${edge.from}`).toBe(true);
      expect(knownNodes.has(edge.to), `Unknown edge destination: ${edge.to}`).toBe(true);
      expect(edge.distance).toBeGreaterThan(0);
    }
  });

  it('does not define duplicate undirected edges', () => {
    const edgeKeys = EDGES.map((edge) => [edge.from, edge.to].sort().join('::'));
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
  });

  it('keeps every POI reachable from the default entrance', () => {
    const adjacency = buildAdjacencyList();
    const visited = new Set([BUILDING_CONFIG.defaultStartNode]);
    const queue = [BUILDING_CONFIG.defaultStartNode];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor.to)) {
          visited.add(neighbor.to);
          queue.push(neighbor.to);
        }
      }
    }

    for (const poi of getPOIs()) {
      expect(visited.has(poi.id), `Unreachable POI: ${poi.id}`).toBe(true);
    }
  });
});
