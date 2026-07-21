import { describe, expect, it } from 'vitest';
import { STEP_TYPE, calculateRoute, type GraphEdge, type GraphNode } from './routingCore';

describe('A* routing core', () => {
  it('finds the known shortest route and emits turn-aware instructions', () => {
    const nodes: GraphNode[] = [
      {
        id: 'start',
        x: 0,
        y: 2,
        floor: 'g',
        type: 'poi',
        poi: { name: 'Start', category: 'test' },
      },
      { id: 'north', x: 0, y: 1, floor: 'g', type: 'junction' },
      { id: 'east', x: 1, y: 1, floor: 'g', type: 'junction' },
      {
        id: 'destination',
        x: 1,
        y: 0,
        floor: 'g',
        type: 'poi',
        poi: { name: 'Destination', category: 'test' },
      },
    ];
    const edges: GraphEdge[] = [
      { from: 'start', to: 'north', distance: 1, corridor: 'North hall' },
      { from: 'north', to: 'east', distance: 1, corridor: 'East hall' },
      { from: 'east', to: 'destination', distance: 1, corridor: 'North hall' },
    ];
    const result = calculateRoute('start', 'destination', nodes, edges);

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.algorithm).toBe('a-star');
    expect(result.pathIds[0]).toBe('start');
    expect(result.pathIds.at(-1)).toBe('destination');
    expect(result.totalDistance).toBe(3);
    expect(result.steps.map((step) => step.type)).toEqual([
      STEP_TYPE.START,
      STEP_TYPE.TURN_RIGHT,
      STEP_TYPE.TURN_LEFT,
      STEP_TYPE.ARRIVE,
    ]);
    expect(result.steps.reduce((total, step) => total + step.distance, 0)).toBe(
      result.totalDistance,
    );
  });

  it('honors accessibility constraints without mutating the graph', () => {
    const nodes: GraphNode[] = [
      { id: 'a', x: 0, y: 0, floor: 1, type: 'junction' },
      { id: 'b', x: 1, y: 0, floor: 1, type: 'junction' },
      { id: 'c', x: 0, y: 2, floor: 1, type: 'junction' },
      { id: 'd', x: 2, y: 0, floor: 1, type: 'junction' },
    ];
    const edges: GraphEdge[] = [
      { from: 'a', to: 'b', distance: 1, accessible: false },
      { from: 'b', to: 'd', distance: 1 },
      { from: 'a', to: 'c', distance: 2 },
      { from: 'c', to: 'd', distance: 2 },
    ];

    const standard = calculateRoute('a', 'd', nodes, edges);
    const accessible = calculateRoute('a', 'd', nodes, edges, { accessibleOnly: true });

    expect(standard.found && standard.pathIds).toEqual(['a', 'b', 'd']);
    expect(accessible.found && accessible.pathIds).toEqual(['a', 'c', 'd']);
    expect(edges[0].accessible).toBe(false);
  });

  it('returns an arrival result when start and destination are identical', () => {
    const nodes: GraphNode[] = [
      {
        id: 'room',
        x: 0,
        y: 0,
        floor: 1,
        type: 'poi',
        poi: { name: 'Room 101', category: 'room' },
      },
    ];
    const result = calculateRoute('room', 'room', nodes, []);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.totalDistance).toBe(0);
    expect(result.steps[0].type).toBe(STEP_TYPE.ARRIVE);
  });

  it('fails cleanly when constraints disconnect the destination', () => {
    const nodes: GraphNode[] = [
      { id: 'a', x: 0, y: 0, floor: 1, type: 'junction' },
      { id: 'b', x: 1, y: 0, floor: 1, type: 'junction' },
    ];
    const edges: GraphEdge[] = [{ from: 'a', to: 'b', distance: 1, accessible: false }];

    expect(calculateRoute('a', 'b', nodes, edges, { accessibleOnly: true })).toEqual({
      found: false,
      error: 'No route satisfies the selected constraints.',
    });
  });

  it('excludes explicitly closed edge IDs without mutating the graph', () => {
    const nodes: GraphNode[] = [
      { id: 'a', x: 0, y: 0, floor: 'g', type: 'junction' },
      { id: 'b', x: 1, y: 0, floor: 'g', type: 'junction' },
      { id: 'c', x: 0, y: 2, floor: 'g', type: 'junction' },
      { id: 'd', x: 2, y: 0, floor: 'g', type: 'junction' },
    ];
    const edges: GraphEdge[] = [
      { id: 'short-a', from: 'a', to: 'b', distance: 1 },
      { id: 'short-b', from: 'b', to: 'd', distance: 1 },
      { id: 'detour-a', from: 'a', to: 'c', distance: 2 },
      { id: 'detour-b', from: 'c', to: 'd', distance: 2 },
    ];

    const result = calculateRoute('a', 'd', nodes, edges, { closedEdgeIds: ['short-a'] });
    expect(result.found && result.pathIds).toEqual(['a', 'c', 'd']);
    expect(edges).toHaveLength(4);
  });
});
