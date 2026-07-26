import { describe, expect, it } from 'vitest';
import type { GraphNode } from './routingCore';
import {
  floorTransitions,
  polygonCentroid,
  routeConnectorRuns,
  routeFloorIds,
  routeSegmentsForFloor,
} from './floorplanModel';

const path: GraphNode[] = [
  { id: 'g-a', x: 0, y: 0, floor: 'g', type: 'space' },
  { id: 'g-lift', x: 1, y: 0, floor: 'g', type: 'connector-stop' },
  { id: 'l1-lift', x: 1, y: 0, floor: 'l1', type: 'connector-stop' },
  { id: 'l1-a', x: 2, y: 0, floor: 'l1', type: 'space' },
];

describe('compiled floorplan model', () => {
  it('computes polygon centroids without assuming rectangular rooms', () => {
    expect(
      polygonCentroid([
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ]),
    ).toEqual([2, 1]);
  });

  it('never draws a vertical transition as a same-floor line', () => {
    expect(routeSegmentsForFloor(path, 'g').map(([from, to]) => [from.id, to.id])).toEqual([
      ['g-a', 'g-lift'],
    ]);
    expect(routeSegmentsForFloor(path, 'l1').map(([from, to]) => [from.id, to.id])).toEqual([
      ['l1-lift', 'l1-a'],
    ]);
  });

  it('marks both ends of a floor transition', () => {
    expect(floorTransitions(path, 'g')).toEqual([{ node: path[1], targetFloorId: 'l1' }]);
    expect(floorTransitions(path, 'l1')).toEqual([{ node: path[2], targetFloorId: 'g' }]);
  });

  it('collapses consecutive connector edges into one named floor run', () => {
    const connectorPath: GraphNode[] = [
      { id: 'g-a', x: 0, y: 0, floor: 'g', type: 'space' },
      {
        id: 'lift:g',
        x: 1,
        y: 0,
        floor: 'g',
        type: 'connector-stop',
        sourceId: 'lift-south',
      },
      {
        id: 'lift:l1',
        x: 1,
        y: 0,
        floor: 'l1',
        type: 'connector-stop',
        sourceId: 'lift-south',
      },
      {
        id: 'lift:l2',
        x: 1,
        y: 0,
        floor: 'l2',
        type: 'connector-stop',
        sourceId: 'lift-south',
      },
      { id: 'l2-a', x: 2, y: 0, floor: 'l2', type: 'space' },
    ];

    expect(routeFloorIds(connectorPath)).toEqual(['g', 'l1', 'l2']);
    expect(routeConnectorRuns(connectorPath)).toEqual([
      {
        connectorId: 'lift-south',
        fromFloorId: 'g',
        toFloorId: 'l2',
        floorIds: ['g', 'l1', 'l2'],
        nodes: connectorPath.slice(1, 4),
      },
    ]);
  });
});
