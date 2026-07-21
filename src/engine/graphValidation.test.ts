import { describe, expect, it } from 'vitest';
import { ROUTING_EDGES, ROUTING_NODES } from '../data/compiledBuilding';
import type { GraphEdge, GraphNode } from './routingCore';
import { validateGraph } from './graphValidation';

describe('graph validation', () => {
  it('accepts the graph emitted by the building compiler', () => {
    expect(validateGraph(ROUTING_NODES, ROUTING_EDGES)).toEqual([]);
  });

  it('reports structural defects with stable issue codes', () => {
    const nodes: GraphNode[] = [
      { id: 'a', x: 0, y: 0, floor: 1, type: 'junction' },
      { id: 'a', x: 1, y: 0, floor: 1, type: 'junction' },
      { id: 'isolated', x: 3, y: 0, floor: 1, type: 'junction' },
    ];
    const edges: GraphEdge[] = [
      { from: 'a', to: 'missing', distance: 0 },
      { from: 'missing', to: 'a', distance: 2 },
    ];

    expect(validateGraph(nodes, edges).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate-node',
        'duplicate-edge',
        'invalid-distance',
        'missing-endpoint',
        'isolated-node',
      ]),
    );
  });
});
