import { describe, expect, it } from 'vitest';
import { ASTERION_RUNTIME } from '../test/venueFixtures';
import { createVenueScopedState } from '../data/venueSession';
import { calculateCompiledRoute } from './compiledRoutePolicy';
import { describeWithLandmarks, landmarksFrom, type Landmark } from './routeLandmarks';
import { calculateRoute, type GraphNode, type RouteStep } from './routingCore';

const node = (id: string, x: number, y: number, floor = 'g', name?: string): GraphNode => ({
  id,
  x,
  y,
  floor,
  type: name ? 'poi' : 'junction',
  ...(name ? { poi: { name, category: 'service' } } : {}),
});
const step = (
  type: RouteStep['type'],
  nodeId: string,
  instruction: string,
  distance = 0,
): RouteStep => ({ type, instruction, distance, nodeId, bearing: 0, floorId: 'g' });

/** A room as a rectangle, with its pin in the middle. */
const room = (
  id: string,
  name: string,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  floorId = 'g',
): Landmark => ({
  id,
  name,
  floorId,
  position: [(x0 + x1) / 2, (y0 + y1) / 2],
  outline: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
});

/*
 * A corridor 8 m wide runs east along y = 0, its centreline the route. Rooms
 * sit either side with their walls at y = -4 and y = 4 and their pins ten
 * metres from the centreline. At x = 30 the route turns right down a second
 * corridor, then hops through a doorway into the destination. Plan +Y is down.
 */
const path = [
  node('start', 0, 0, 'g', 'Main Entrance'),
  node('corner', 30, 0),
  node('door', 30, 20),
  node('inside', 30, 24),
  node('clinic', 40, 24, 'g', 'Ear Clinic'),
];
const steps = [
  step('start', 'start', 'Start at Main Entrance and continue on East Corridor', 30),
  step('turn_right', 'corner', 'Turn right onto South Corridor', 20),
  step('straight', 'door', 'Continue on Ear Clinic', 14),
  step('arrive', 'clinic', 'Arrive at Ear Clinic'),
];
const places = [
  room('cafe', 'Café', [10, 4], [20, 24]), // south side, passed on the first stretch
  room('imaging', 'Imaging', [2, -24], [8, -4]), // north side, first place passed
  room('reception', 'Reception', [31, -24], [41, -4]), // beside the corner
  room('boiler', 'Boiler Room', [10, 40], [20, 60]), // across the way, a second corridor off
  room('library', 'Library', [10, 4], [20, 24], 'l1'), // same footprint, upstairs
  room('ward', 'Ward', [34, 4], [44, 20]), // a neighbour of the destination
];

describe('directions in landmarks', () => {
  const described = describeWithLandmarks(steps, path, places);

  it('describes a turn at the place whose room is nearest the corner', () => {
    expect(described[1].instruction).toBe('Turn right at Reception onto South Corridor');
  });

  it('heads towards the first room passed, judged by its wall rather than its pin', () => {
    expect(described[0].instruction).toBe(
      'Start at Main Entrance and continue on East Corridor, towards Imaging',
    );
  });

  it('names the last room passed on a stretch between manoeuvres', () => {
    const longer = describeWithLandmarks(
      [
        step('start', 'start', 'Start at Main Entrance', 4),
        step('straight', 'mid', 'Continue on East Corridor', 26),
        step('turn_right', 'corner', 'Turn right onto South Corridor', 20),
        step('straight', 'door', 'Continue on Ear Clinic', 14),
        step('arrive', 'clinic', 'Arrive at Ear Clinic'),
      ],
      [path[0], node('mid', 4, 0), ...path.slice(1)],
      places,
    );
    expect(longer[1].instruction).toBe('Continue on East Corridor, past Café');
  });

  it('still finds rooms when the corridor is a chain of waypoints landing on their pins', () => {
    // Waypoints every 5 m, one of them exactly level with the café's pin.
    const dense = [
      node('start', 0, 0, 'g', 'Main Entrance'),
      node('w1', 5, 0),
      node('w2', 10, 0),
      node('w3', 15, 0),
      node('w4', 20, 0),
      node('w5', 25, 0),
      ...path.slice(1),
    ];
    const described = describeWithLandmarks(
      [
        step('start', 'start', 'Start at Main Entrance', 2),
        step('straight', 'w1', 'Continue on East Corridor', 28),
        step('turn_right', 'corner', 'Turn right onto South Corridor', 20),
        step('straight', 'door', 'Continue on Ear Clinic', 14),
        step('arrive', 'clinic', 'Arrive at Ear Clinic'),
      ],
      dense,
      places,
    );
    expect(described[1].instruction).toBe('Continue on East Corridor, past Café');
  });

  it('leaves a room across another corridor, or on another floor, unmentioned', () => {
    const text = described.map((entry) => entry.instruction).join(' ');
    expect(text).not.toContain('Boiler Room');
    expect(text).not.toContain('Library');
  });

  it('does not treat the destination’s neighbours as landmarks on the final walk in', () => {
    expect(described[2].instruction).toBe('Continue on Ear Clinic');
  });

  it('reads the side of the door from the corridor, looking past the doorway hops', () => {
    // Heading south, a door to the east is on the left.
    expect(described[3].instruction).toBe('Arrive at Ear Clinic, on your left');
    const mirrored = describeWithLandmarks(
      steps,
      [...path.slice(0, 4), node('clinic', 20, 24, 'g', 'Ear Clinic')],
      places,
    );
    expect(mirrored[3].instruction).toBe('Arrive at Ear Clinic, on your right');
  });

  it('says nothing about the side when a corridor leads straight to the door', () => {
    const ahead = describeWithLandmarks(
      steps,
      [...path.slice(0, 3), node('inside', 30, 24), node('clinic', 30, 26, 'g', 'Ear Clinic')],
      places,
    );
    expect(ahead[3].instruction).toBe('Arrive at Ear Clinic');
  });

  it('never uses the journey’s own ends as landmarks for other steps', () => {
    const withEnds = describeWithLandmarks(steps, path, [
      ...places,
      room('entry', 'Main Entrance', [-4, -4], [4, 4]),
      room('dest', 'Ear Clinic', [34, 20], [46, 28]),
    ]);
    expect(withEnds[1].instruction).toBe('Turn right at Reception onto South Corridor');
    expect(withEnds[2].instruction).toBe('Continue on Ear Clinic');
  });

  it('does not name a place both as passed and as the corner it marks', () => {
    const onlyReception = describeWithLandmarks(steps, path, [places[2]]);
    expect(onlyReception[0].instruction).toBe(
      'Start at Main Entrance and continue on East Corridor',
    );
    expect(onlyReception[1].instruction).toBe('Turn right at Reception onto South Corridor');
  });

  it('leaves a short stretch, and a turn with nothing nearby, alone', () => {
    const nothingNear = describeWithLandmarks(steps, path, [places[0]]);
    expect(nothingNear[1].instruction).toBe('Turn right onto South Corridor');
    const short = describeWithLandmarks(
      [step('start', 'a', 'Start at A', 4), step('arrive', 'b', 'Arrive at B')],
      [node('a', 0, 0), node('b', 4, 0)],
      [room('x', 'X', [1, 1], [3, 3])],
    );
    expect(short[0].instruction).toBe('Start at A');
  });

  it('names a place once across a dog-leg of two turns beside it', () => {
    const dogleg = describeWithLandmarks(
      [
        step('start', 'a', 'Start at A', 20),
        step('turn_right', 'b', 'Turn right', 4),
        step('turn_left', 'c', 'Turn left onto Far Corridor', 20),
        step('arrive', 'd', 'Arrive at D'),
      ],
      [node('a', 0, 0), node('b', 20, 0), node('c', 20, 4), node('d', 40, 4)],
      [room('block', 'Radiology', [21, -20], [41, 3])],
    );
    expect(dogleg[1].instruction).toBe('Turn right at Radiology');
    expect(dogleg[2].instruction).toBe('Turn left onto Far Corridor');
  });

  it('falls back to the pin for a place with no room outline', () => {
    const pinned = describeWithLandmarks(steps, path, [
      { id: 'kiosk', name: 'Kiosk', floorId: 'g', position: [31, 3] },
    ]);
    expect(pinned[1].instruction).toBe('Turn right at Kiosk onto South Corridor');
  });

  it('keeps every other field of a step and never mutates its input', () => {
    expect(described[1]).toMatchObject({ type: 'turn_right', nodeId: 'corner', distance: 20 });
    expect(steps[1].instruction).toBe('Turn right onto South Corridor');
    expect(describeWithLandmarks([], path, places)).toEqual([]);
  });

  it('takes public, named destinations from a package, with their rooms', () => {
    const found = landmarksFrom({
      pois: [
        { id: 'a', name: 'Shop', floorId: 'g', position: [1, 2], public: true, spaceId: 's1' },
        { id: 'b', name: 'Store', floorId: 'g', position: [3, 4], public: false, spaceId: 's1' },
        { id: 'c', name: '  ', floorId: 'g', position: [5, 6] },
        { id: 'd', name: 'Desk', floorId: 'g', position: [7, 8], spaceId: 'missing' },
      ],
      spaces: [
        {
          id: 's1',
          polygon: [
            [0, 0],
            [2, 0],
            [2, 4],
            [0, 4],
          ],
        },
      ],
    });
    expect(found.map((entry) => entry.name)).toEqual(['Shop', 'Desk']);
    expect(found[0].outline).toHaveLength(4);
    expect(found[1].outline).toBeUndefined();
  });
});

describe('landmark directions on a compiled venue', () => {
  const start = createVenueScopedState(ASTERION_RUNTIME).navigation.startNodeId;
  const raw = (destination: string) => {
    const route = calculateRoute(
      start,
      destination,
      ASTERION_RUNTIME.routingNodes,
      ASTERION_RUNTIME.routingEdges,
    );
    if (!route.found) throw new Error('Fixture route must exist');
    return route.steps.map((entry) => entry.instruction);
  };

  it.each(['poi:poi-pharmacy', 'poi:poi-maternity', 'poi:poi-cardiology'])(
    'rewrites the graph’s directions to %s in the venue’s own places',
    (destination) => {
      const route = calculateCompiledRoute(ASTERION_RUNTIME, start, destination);
      if (!route.found) throw new Error('Fixture route must exist');
      const before = raw(destination);
      const after = route.steps.map((entry) => entry.instruction);
      expect(after).toHaveLength(before.length);
      const changed = after.filter((text, index) => text !== before[index]);
      expect(changed.length).toBeGreaterThan(0);
      const names = landmarksFrom(ASTERION_RUNTIME.buildingPackage).map((entry) => entry.name);
      for (const text of changed) {
        expect(names.some((name) => text.includes(name))).toBe(true);
      }
      // The destination is never a landmark on the way to itself.
      const destinationName = route.path[route.path.length - 1].poi?.name ?? '';
      expect(
        after
          .slice(0, -1)
          .some((text) => new RegExp(`(?:past|at|towards) ${destinationName}$`).test(text)),
      ).toBe(false);
    },
  );

  it('tells the visitor which side the pharmacy door is on', () => {
    const route = calculateCompiledRoute(ASTERION_RUNTIME, start, 'poi:poi-pharmacy');
    if (!route.found) throw new Error('Fixture route must exist');
    expect(route.steps[route.steps.length - 1].instruction).toMatch(
      /^Arrive at Outpatient Pharmacy, on your (?:left|right)$/,
    );
  });
});
