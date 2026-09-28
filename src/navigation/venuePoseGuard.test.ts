import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../engine/routingCore';
import { buildRouteTrack } from './routeProgress';
import { VenuePoseGuard } from './venuePoseGuard';
import { ASTERION_RUNTIME, HARBOR_RUNTIME } from '../test/venueFixtures';

const node = (id: string, x: number, y: number, floor = 'g'): GraphNode => ({
  id,
  x,
  y,
  floor,
  type: 'junction',
});
const a = node('a', 0, 0);
const b = node('b', 30, 0);
const c = node('c', 30, 10);
const track = buildRouteTrack([a, b], []);
const edge = (from: GraphNode, to: GraphNode): GraphEdge => ({
  from: from.id,
  to: to.id,
  distance: Math.hypot(to.x - from.x, to.y - from.y),
});
const input = {
  x: 3,
  y: 1,
  originProgressMeters: 0,
  walkedMeters: Math.sqrt(10),
  routeDistanceMeters: 1,
  maximumDistanceMeters: 3,
};

describe('venue alternatives to a selected route', () => {
  it.each([ASTERION_RUNTIME, HARBOR_RUNTIME])(
    'accepts exact planar paths in $config.name',
    (venue) => {
      const guard = new VenuePoseGuard(venue.routingNodes, venue.routingEdges);
      let checked = 0;
      for (const link of venue.routingEdges) {
        const from = venue.getNodeById(link.from)!;
        const to = venue.getNodeById(link.to)!;
        if (from.floor !== to.floor || link.kind === 'vertical-connector') continue;
        const route = buildRouteTrack([from, to], []);
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (length < 0.01) continue;
        expect(
          guard.assess(route, {
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2,
            originProgressMeters: 0,
            walkedMeters: length / 2,
            routeDistanceMeters: 0,
            maximumDistanceMeters: 1.5,
          }),
          link.id,
        ).toBe('clear');
        checked += 1;
      }
      expect(checked).toBeGreaterThan(30);
    },
  );
  it('detects an unselected fork before walking can teach its direction as route heading', () => {
    const guard = new VenuePoseGuard([a, b, c], [edge(a, b), edge(a, c)]);
    expect(guard.assess(track, input)).toBe('ambiguous');
  });

  it('keeps the branch reachable from the placement, not just the last route projection', () => {
    const shallow = node('shallow', 30, 3);
    const guard = new VenuePoseGuard([a, b, shallow], [edge(a, b), edge(a, shallow)]);
    expect(
      guard.assess(track, { ...input, x: 6, y: 0.6, walkedMeters: 6.1, routeDistanceMeters: 0.6 }),
    ).toBe('ambiguous');
  });

  it('does not stop normal travel along the selected side of a fork', () => {
    const guard = new VenuePoseGuard([a, b, c], [edge(a, b), edge(a, c)]);
    for (const x of [0.1, 0.5, 1, 3, 8, 20]) {
      expect(
        guard.assess(track, { ...input, x, y: 0, walkedMeters: x, routeDistanceMeters: 0 }),
      ).toBe('clear');
    }
  });

  it('does not call a shared junction or an overlapping graph edge a second position', () => {
    const duplicate = node('duplicate', 20, 0);
    const guard = new VenuePoseGuard(
      [a, b, c, duplicate],
      [edge(a, b), edge(a, c), edge(a, duplicate)],
    );
    expect(
      guard.assess(track, {
        ...input,
        x: 0.3,
        y: 0.1,
        walkedMeters: 0.4,
        routeDistanceMeters: 0.1,
      }),
    ).toBe('clear');
    expect(
      guard.assess(track, { ...input, x: 8, y: 0, walkedMeters: 8, routeDistanceMeters: 0 }),
    ).toBe('clear');
  });

  it('ignores disconnected nearby lines and paths reached only by changing floor', () => {
    const d = node('d', 0, 1);
    const e = node('e', 30, 1);
    const up = node('up', 0, 0, 'l1');
    for (const links of [[], [edge(a, up), edge(up, d)]]) {
      const guard = new VenuePoseGuard([a, b, d, e, up], [edge(a, b), edge(d, e), ...links]);
      expect(guard.assess(track, input)).toBe('clear');
    }
  });

  it('cannot reach a nearby parallel corridor through a distant connection', () => {
    const d = node('d', 30, 1);
    const e = node('e', 0, 1);
    const guard = new VenuePoseGuard([a, b, d, e], [edge(a, b), edge(b, d), edge(d, e)]);
    expect(guard.assess(track, input)).toBe('clear');
  });

  it('does consider a parallel corridor connected near the placement', () => {
    const d = node('d', 0, 1);
    const e = node('e', 30, 1);
    const guard = new VenuePoseGuard([a, b, d, e], [edge(a, b), edge(a, d), edge(d, e)]);
    expect(guard.assess(track, input)).toBe('ambiguous');
  });

  it('does not exempt a later visit to this floor from the alternative-path check', () => {
    const d = node('d', 0, 1);
    const e = node('e', 30, 1);
    const upB = node('up-b', 30, 0, 'l1');
    const upD = node('up-d', 0, 1, 'l1');
    const route = buildRouteTrack([a, b, upB, upD, d, e], []);
    const guard = new VenuePoseGuard(
      [a, b, upB, upD, d, e],
      [edge(a, b), edge(b, upB), edge(upB, upD), edge(upD, d), edge(d, e), edge(a, d)],
    );
    expect(guard.assess(route, input)).toBe('ambiguous');
  });

  it('keeps physical alternatives even when routing policy would forbid using them', () => {
    const guard = new VenuePoseGuard(
      [a, b, c],
      [edge(a, b), { ...edge(a, c), accessible: false, restricted: true }],
    );
    expect(guard.assess(track, input)).toBe('ambiguous');
  });

  it('is invariant under subdividing an alternative or reversing edge storage', () => {
    const mid = node('mid', 2, 2 / 3);
    const guard = new VenuePoseGuard([a, b, c, mid], [edge(b, a), edge(mid, a), edge(c, mid)]);
    expect(guard.assess(track, input)).toBe('ambiguous');
  });

  it('handles zero-length portal links without losing connectivity', () => {
    const portal = node('portal', 0, 0);
    const guard = new VenuePoseGuard(
      [a, b, c, portal],
      [edge(a, b), edge(a, portal), edge(portal, c)],
    );
    expect(guard.assess(track, input)).toBe('ambiguous');
  });

  it('seeds both ends of a placement in the middle of an edge', () => {
    const mid = node('fork', 10, 0);
    const side = node('side', 20, 3);
    const route = buildRouteTrack([a, mid, b], []);
    const guard = new VenuePoseGuard(
      [a, mid, b, side],
      [edge(a, mid), edge(mid, b), edge(mid, side)],
    );
    expect(
      guard.assess(route, {
        ...input,
        originProgressMeters: 8,
        x: 13,
        y: 0.9,
        routeDistanceMeters: 0.9,
        walkedMeters: 5.2,
      }),
    ).toBe('ambiguous');
    // A new placement past the branch has insufficient travel to come back to it.
    expect(
      guard.assess(route, {
        ...input,
        originProgressMeters: 20,
        x: 20,
        y: 3,
        routeDistanceMeters: 3,
        walkedMeters: 3,
      }),
    ).toBe('clear');
  });

  it('never reports a successful check for missing or mismatched origin geometry', () => {
    expect(
      new VenuePoseGuard([a, c], [edge(a, c)]).assess(track, { ...input, originProgressMeters: 2 }),
    ).toBe('unavailable');
    expect(new VenuePoseGuard([{ ...a, x: 5 }, b], [edge(a, b)]).assess(track, input)).toBe(
      'unavailable',
    );
    expect(
      new VenuePoseGuard([a, b], [edge(a, b)]).assess(track, { ...input, walkedMeters: NaN }),
    ).toBe('unavailable');
  });
});
