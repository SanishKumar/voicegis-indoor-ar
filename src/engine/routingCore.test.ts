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

  it('keeps a consecutive lift run as one instruction to the exit floor', () => {
    const nodes: GraphNode[] = [
      { id: 'start', x: 0, y: 0, floor: 'g', floorName: 'Ground', type: 'poi' },
      {
        id: 'lift-g',
        x: 1,
        y: 0,
        floor: 'g',
        floorName: 'Ground',
        type: 'connector-stop',
      },
      {
        id: 'lift-l1',
        x: 1,
        y: 0,
        floor: 'l1',
        floorName: 'Level 1',
        type: 'connector-stop',
      },
      {
        id: 'lift-l2',
        x: 1,
        y: 0,
        floor: 'l2',
        floorName: 'Level 2',
        type: 'connector-stop',
      },
      { id: 'destination', x: 2, y: 0, floor: 'l2', floorName: 'Level 2', type: 'poi' },
    ];
    const edges: GraphEdge[] = [
      { from: 'start', to: 'lift-g', distance: 1 },
      {
        from: 'lift-g',
        to: 'lift-l1',
        distance: 4.8,
        kind: 'vertical-connector',
        connectorKind: 'elevator',
        sourceId: 'lift-south',
        corridor: 'South Lift Bank',
      },
      {
        from: 'lift-l1',
        to: 'lift-l2',
        distance: 4.2,
        kind: 'vertical-connector',
        connectorKind: 'elevator',
        sourceId: 'lift-south',
        corridor: 'South Lift Bank',
      },
      { from: 'lift-l2', to: 'destination', distance: 1 },
    ];

    const result = calculateRoute('start', 'destination', nodes, edges);

    expect(result.found).toBe(true);
    if (!result.found) return;
    const liftSteps = result.steps.filter((step) => step.type === STEP_TYPE.ELEVATOR);
    expect(liftSteps).toHaveLength(1);
    expect(liftSteps[0]).toMatchObject({
      instruction: 'Take South Lift Bank to Level 2',
      distance: 9,
      floorId: 'l2',
    });
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

describe('start instruction', () => {
  const corridorNamedAfterItsEntrance = (): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } => ({
    nodes: [
      {
        id: 'entrance',
        x: 0,
        y: 0,
        floor: 'g',
        type: 'poi',
        poi: { name: 'Civic Plaza Entrance', category: 'entrance' },
      },
      { id: 'middle', x: 0, y: 1, floor: 'g', type: 'junction' },
      {
        id: 'desk',
        x: 0,
        y: 2,
        floor: 'g',
        type: 'poi',
        poi: { name: 'Reception', category: 'service' },
      },
    ],
    edges: [
      // The first corridor carries the same name as the point it starts from,
      // which is ordinary in a compiled package: an entrance is both a place
      // and the hall leading out of it.
      { from: 'entrance', to: 'middle', distance: 5, corridor: 'Civic Plaza Entrance' },
      { from: 'middle', to: 'desk', distance: 5, corridor: 'Central Concourse' },
    ],
  });

  it('does not tell the visitor to continue onto where they already are', () => {
    const { nodes, edges } = corridorNamedAfterItsEntrance();
    const result = calculateRoute('entrance', 'desk', nodes, edges);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.steps[0].instruction).toBe('Start at Civic Plaza Entrance');
  });

  it('still names the first corridor when it is somewhere else', () => {
    const { nodes, edges } = corridorNamedAfterItsEntrance();
    edges[0].corridor = 'Central Concourse';
    const result = calculateRoute('entrance', 'desk', nodes, edges);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.steps[0].instruction).toBe(
      'Start at Civic Plaza Entrance and continue on Central Concourse',
    );
  });
});
