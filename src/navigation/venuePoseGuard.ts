import type { GraphEdge, GraphNode } from '../engine/routingCore';
import { positionAt, type RouteTrack, type TrackPoint } from './routeProgress';
import { ROUTE_POSE_POLICY } from './routePoseMatcher';

/** Provisional separation of two location hypotheses, not a measured corridor width. */
export const VENUE_POSE_POLICY = Object.freeze({ distinctPositionMeters: 0.5 });

export type VenuePoseAssessment = 'clear' | 'ambiguous' | 'unavailable';
interface Point {
  x: number;
  y: number;
}
interface Segment {
  from: TrackPoint;
  to: TrackPoint;
  length: number;
}
interface AssessmentInput extends Point {
  originProgressMeters: number;
  /** Measured travel since this placement, never time or preview progress. */
  walkedMeters: number;
  routeDistanceMeters: number;
  maximumDistanceMeters: number;
}
const pair = (a: string, b: string) => JSON.stringify([a, b].sort());
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function project(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const squared = dx * dx + dy * dy;
  const t =
    squared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / squared));
  const projected = { x: from.x + t * dx, y: from.y + t * dy };
  return { ...projected, t, distance: distance(point, projected) };
}

/**
 * A veto on route-only pose matching, not a whole-building position solver.
 * Keeps alternative paths reachable from the placement's origin in play until
 * their graph distance exceeds measured travel plus the fixed rounding guard.
 * Seeding each check from the latest route projection would discard a shallow
 * fork before it separates from the route, then incorrectly learn its heading.
 *
 * Graph edges are undirected, as in the router. Only planar same-floor links
 * participate. Access restrictions/closures affect allowed routes, not whether
 * someone could physically be there. No alternative here authorizes rerouting.
 * A 'clear' result is NOT proof of the selected corridor or of free space.
 */
export class VenuePoseGuard {
  private readonly nodes = new Map<string, TrackPoint>();
  private readonly segments: Segment[] = [];
  private readonly adjacency = new Map<string, { to: string; length: number }[]>();
  private readonly pairs = new Set<string>();
  private cached: {
    track: RouteTrack;
    origin: number;
    floor: string;
    costs: Map<string, number>;
    selected: Set<string>;
    routeSegments: Segment[];
  } | null = null;

  constructor(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
    for (const node of nodes) {
      if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
        this.nodes.set(node.id, { id: node.id, x: node.x, y: node.y, floor: String(node.floor) });
      }
    }
    for (const edge of edges) {
      const from = this.nodes.get(edge.from);
      const to = this.nodes.get(edge.to);
      if (!from || !to || from.floor !== to.floor || edge.kind === 'vertical-connector') continue;
      const key = pair(from.id, to.id);
      if (this.pairs.has(key)) continue;
      this.pairs.add(key);
      // Geometric metres, not rounded routing costs or accessibility penalties.
      const length = distance(from, to);
      this.segments.push({ from, to, length });
      for (const [a, b] of [
        [from, to],
        [to, from],
      ]) {
        const links = this.adjacency.get(a.id) ?? [];
        links.push({ to: b.id, length });
        this.adjacency.set(a.id, links);
      }
    }
  }

  private prepare(track: RouteTrack, origin: number) {
    if (this.cached?.track === track && this.cached.origin === origin) return this.cached;
    this.cached = null;
    const position = positionAt(track, origin);
    if (position.vertical) return null;
    const selected = new Set<string>();
    const routeSegments: Segment[] = [];
    const seeds = new Map<string, number>();
    let floorStart = 0;
    let floorEnd = track.length;
    for (let i = 0; i + 1 < track.points.length; i += 1) {
      if (track.points[i].floor === track.points[i + 1].floor) continue;
      if (track.at[i + 1] <= origin + 1e-6) floorStart = track.at[i + 1];
      else {
        floorEnd = track.at[i];
        break;
      }
    }
    for (const point of track.points) {
      const graphPoint = this.nodes.get(point.id);
      if (!graphPoint || graphPoint.floor !== point.floor || distance(graphPoint, point) > 1e-6)
        return null;
    }
    for (let i = 0; i < track.points.length; i += 1) {
      const from = track.points[i];
      if (from.floor === position.floor && Math.abs(track.at[i] - origin) < 1e-6)
        seeds.set(from.id, 0);
      const to = track.points[i + 1];
      if (!to || from.floor !== to.floor) continue;
      const key = pair(from.id, to.id);
      if (!this.pairs.has(key) && from.id !== to.id) return null;
      // A later return to this floor does not make that corridor part of the
      // current planar journey. It can still be a competing location now.
      if (
        from.floor === position.floor &&
        track.at[i] >= floorStart &&
        track.at[i + 1] <= floorEnd
      ) {
        selected.add(key);
        routeSegments.push({ from, to, length: distance(from, to) });
      }
      if (from.floor === position.floor && origin > track.at[i] && origin < track.at[i + 1]) {
        seeds.set(from.id, distance(position, from));
        seeds.set(to.id, distance(position, to));
      }
    }
    if (seeds.size === 0) return null;
    // Cached per placement. The small venue graph need not be searched every frame.
    const costs = new Map(seeds);
    const pending = [...seeds].map(([id, cost]) => ({ id, cost }));
    while (pending.length > 0) {
      pending.sort((a, b) => b.cost - a.cost);
      const current = pending.pop()!;
      if (current.cost !== costs.get(current.id)) continue;
      for (const link of this.adjacency.get(current.id) ?? []) {
        const next = current.cost + link.length;
        if (next >= (costs.get(link.to) ?? Infinity)) continue;
        costs.set(link.to, next);
        pending.push({ id: link.to, cost: next });
      }
    }
    this.cached = { track, origin, floor: position.floor, costs, selected, routeSegments };
    return this.cached;
  }

  assess(track: RouteTrack, input: AssessmentInput): VenuePoseAssessment {
    const {
      originProgressMeters: origin,
      walkedMeters,
      routeDistanceMeters,
      maximumDistanceMeters,
    } = input;
    if (
      ![input.x, input.y, origin, walkedMeters, routeDistanceMeters, maximumDistanceMeters].every(
        Number.isFinite,
      ) ||
      track.points.length === 0 ||
      origin < 0 ||
      origin > track.length ||
      walkedMeters < 0 ||
      routeDistanceMeters < 0 ||
      maximumDistanceMeters <= 0
    )
      return 'unavailable';
    const prepared = this.prepare(track, origin);
    if (!prepared) return 'unavailable';
    const budget = walkedMeters + ROUTE_POSE_POLICY.progressSlackMeters;
    const limit = Math.min(
      maximumDistanceMeters,
      routeDistanceMeters + ROUTE_POSE_POLICY.ambiguityDistanceMeters,
    );
    for (const { from, to, length } of this.segments) {
      if (from.floor !== prepared.floor || prepared.selected.has(pair(from.id, to.id))) continue;
      const candidate = project(input, from, to);
      if (candidate.distance > limit) continue;
      const cost = Math.min(
        (prepared.costs.get(from.id) ?? Infinity) + candidate.t * length,
        (prepared.costs.get(to.id) ?? Infinity) + (1 - candidate.t) * length,
      );
      if (cost > budget + 1e-6) continue;
      // At a junction several edges describe the same location. Overlapping
      // edges/short subdivisions must not invent distinct physical positions.
      let separation = Infinity;
      for (const segment of prepared.routeSegments)
        separation = Math.min(separation, project(candidate, segment.from, segment.to).distance);
      if (separation > VENUE_POSE_POLICY.distinctPositionMeters) return 'ambiguous';
    }
    return 'clear';
  }
}
