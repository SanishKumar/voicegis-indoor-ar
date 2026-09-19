import { describe, expect, it } from 'vitest';
import type { GraphNode, RouteStep } from '../engine/routingCore';
import type { Landmark } from '../engine/routeLandmarks';
import { buildRouteTrack } from '../navigation/routeProgress';
import { calloutsAhead, shortStepTitle } from './callouts';

const node = (id: string, x: number, y: number, floor = 'g'): GraphNode => ({
  id,
  x,
  y,
  floor,
  type: 'junction',
});
const step = (type: RouteStep['type'], nodeId: string, instruction: string): RouteStep => ({
  type,
  instruction,
  distance: 0,
  nodeId,
  bearing: 0,
});

/*
 * 20 m east, a right turn, 12 m south to a lift, one storey up, then 8 m
 * east to the clinic. Plan +Y is down, so south is +Y.
 */
const track = buildRouteTrack(
  [
    node('a', 0, 0),
    node('b', 20, 0),
    node('lift-g', 20, 12),
    node('lift-1', 20, 12, 'l1'),
    node('d', 28, 12, 'l1'),
  ],
  [
    step('start', 'a', 'Start at Main Entrance and continue on East Corridor'),
    step('turn_right', 'b', 'Turn right at Reception onto South Corridor'),
    step('elevator', 'lift-g', 'Take Atrium Lift to Level 1 · Clinics'),
    step('straight', 'lift-1', 'Continue on Clinic Corridor'),
    step('arrive', 'd', 'Arrive at Ear Clinic, on your left'),
  ],
);
const landmarks: Landmark[] = [
  { id: 'reception', name: 'Reception', floorId: 'g', position: [22, 2] },
  { id: 'cafe', name: 'Café', floorId: 'g', position: [10, 6] },
  { id: 'far', name: 'Radiology', floorId: 'g', position: [60, 40] },
  { id: 'clinic', name: 'Ear Clinic', floorId: 'l1', position: [28, 12] },
  { id: 'ward', name: 'Ward', floorId: 'l1', position: [24, 16] },
];
const base = { track, destinationName: 'Ear Clinic', landmarks };

describe('what is labelled in the world ahead', () => {
  const steps = [
    step('start', 'a', 'Start at Main Entrance and continue on East Corridor'),
    step('turn_right', 'b', 'Turn right at Reception onto South Corridor'),
    step('elevator', 'lift-g', 'Take Atrium Lift to Level 1 · Clinics'),
    step('straight', 'lift-1', 'Continue on Clinic Corridor'),
    step('arrive', 'd', 'Arrive at Ear Clinic, on your left'),
  ];

  it('names the corner, the lift and the nearby places from the start', () => {
    const callouts = calloutsAhead({
      ...base,
      steps,
      progressMeters: 0,
      floorId: 'g',
      aheadMeters: 40,
    });
    const byKind = Object.fromEntries(callouts.map((callout) => [callout.kind, callout]));
    expect(byKind.destination).toBeUndefined();
    expect(byKind.turn).toMatchObject({
      title: 'South Corridor',
      detail: '20 m',
      stepType: 'turn_right',
      x: 20,
      y: 0,
    });
    expect(byKind.connector).toMatchObject({
      kicker: 'Lift',
      title: 'Atrium Lift',
      detail: '32 m · to Level 1',
      stepType: 'elevator',
      x: 20,
      y: 12,
    });
    // Reception is 22 m off, beyond what is pointed out; Radiology further still.
    const places = callouts.filter((callout) => callout.kind === 'place');
    expect(places.map((place) => place.title)).toEqual(['Café']);
    expect(places[0].detail).toBe('12 m');
    const nearer = calloutsAhead({ ...base, steps, progressMeters: 15, floorId: 'g' });
    expect(
      nearer.filter((callout) => callout.kind === 'place').map((place) => place.title),
    ).toEqual(['Reception', 'Café']);
  });

  it('labels the destination with distance and time once it is on this floor', () => {
    const callouts = calloutsAhead({ ...base, steps, progressMeters: 40, floorId: 'l1' });
    expect(callouts.map((callout) => callout.kind)).toEqual(['destination', 'place']);
    expect(callouts[0]).toMatchObject({
      title: 'Ear Clinic',
      detail: '6 m (Under 1 min)',
      x: 28,
      y: 12,
    });
    // The destination is not also a place beside the route.
    expect(callouts[1].title).toBe('Ward');
  });

  it('labels nothing on a storey the visitor is not looking at', () => {
    expect(calloutsAhead({ ...base, steps, progressMeters: 0, floorId: 'l1' })).toEqual([]);
  });

  it('keeps the labels within the distance asked for', () => {
    const near = calloutsAhead({
      ...base,
      steps,
      progressMeters: 0,
      floorId: 'g',
      aheadMeters: 10,
    });
    expect(near.filter((callout) => callout.kind !== 'place')).toEqual([]);
    const corner = calloutsAhead({ ...base, steps, progressMeters: 19, floorId: 'g' });
    expect(corner.find((callout) => callout.kind === 'turn')?.detail).toBe('1 m');
    const past = calloutsAhead({ ...base, steps, progressMeters: 20.5, floorId: 'g' });
    expect(past.find((callout) => callout.kind === 'turn')).toBeUndefined();
  });

  it('falls back to the manoeuvre when an instruction names no corridor or place', () => {
    const plain = [
      step('start', 'a', 'Start here'),
      step('turn_left', 'b', 'Turn left'),
      step('arrive', 'lift-g', 'Arrive'),
    ];
    const short = buildRouteTrack(
      [node('a', 0, 0), node('b', 20, 0), node('lift-g', 20, 12)],
      plain,
    );
    const callouts = calloutsAhead({
      track: short,
      steps: plain,
      progressMeters: 0,
      floorId: 'g',
      destinationName: 'Somewhere',
      landmarks: [],
      aheadMeters: 40,
    });
    expect(callouts.map((callout) => [callout.kind, callout.title])).toEqual([
      ['destination', 'Somewhere'],
      ['turn', 'Turn left'],
    ]);
  });
});

describe('the place a step is about, for a card read at a glance', () => {
  const titled = (type: RouteStep['type'], instruction: string) =>
    shortStepTitle(step(type, 'n', instruction));

  it('names the corridor a turn leads onto', () => {
    expect(titled('turn_right', 'Turn right at Reception onto South Corridor')).toBe(
      'South Corridor',
    );
    // No corridor named, so the place the turn happens at will do.
    expect(titled('turn_left', 'Turn left at Maternity Clinic')).toBe('Maternity Clinic');
    // Neither, so the manoeuvre stands on its own.
    expect(titled('u_turn', 'Turn around')).toBe('Turn around');
  });

  it('names the corridor being walked, not the reason for walking it', () => {
    expect(
      titled(
        'start',
        "Start at your location and continue on Family Care Concourse, towards Women's Imaging",
      ),
    ).toBe('Family Care Concourse');
    expect(titled('straight', 'Continue on South Stair Hall · Level 2')).toBe('South Stair Hall');
    expect(titled('straight', 'Continue on East Corridor, past Café')).toBe('East Corridor');
  });

  it('names the stair or lift being taken, not the floor it reaches', () => {
    expect(titled('stairs', 'Take South Public Stair to Ground · Diagnostics')).toBe(
      'South Public Stair',
    );
  });

  it('names the destination without the side its door is on', () => {
    expect(titled('arrive', 'Arrive at Outpatient Pharmacy, on your left')).toBe(
      'Outpatient Pharmacy',
    );
    expect(titled('arrive', 'Arrive at Ear Clinic')).toBe('Ear Clinic');
  });

  it('falls back to the instruction when it names no place at all', () => {
    expect(titled('start', 'Start here')).toBe('Start here');
  });
});
