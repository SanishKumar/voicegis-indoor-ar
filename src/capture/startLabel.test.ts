import { describe, expect, it } from 'vitest';
import { startPointLabel } from './startLabel';

const names = {
  space: (id: string) => (id === 'l2-concourse' ? 'Family Care Concourse' : null),
  floor: (id: string) => (id === 'l2' ? 'Level 2' : null),
};

const checkIn = {
  anchorId: 'anchor-l2-east',
  floorId: 'l2',
  spaceId: 'l2-concourse',
  nodeId: 'waypoint:l2-concourse:11',
  distanceMeters: 1,
};

describe('naming the starting point', () => {
  it('names the check-in when the start is an unnamed corridor node', () => {
    // The bug this exists for: a scan resolves to the nearest routable node,
    // which is a waypoint with no POI, so the app said "Choose a starting
    // point" one second after telling the visitor it knew where they were.
    expect(
      startPointLabel({ id: 'waypoint:l2-concourse:11' }, checkIn, names, 'Choose a starting point'),
    ).toBe('Family Care Concourse');
  });

  it('prefers a real POI name over the check-in', () => {
    expect(
      startPointLabel(
        { id: 'waypoint:l2-concourse:11', poi: { name: 'Family Reception' } },
        checkIn,
        names,
        'Choose a starting point',
      ),
    ).toBe('Family Reception');
  });

  it('stops naming the check-in once the visitor moves the start themselves', () => {
    // Otherwise a stale check-in keeps labelling a place they walked away from.
    expect(startPointLabel({ id: 'some-other-node' }, checkIn, names, 'Choose a starting point')).toBe(
      'Choose a starting point',
    );
  });

  it('falls back when there is no start and no check-in', () => {
    expect(startPointLabel(null, null, names, 'Starting point not set')).toBe(
      'Starting point not set',
    );
  });
});
