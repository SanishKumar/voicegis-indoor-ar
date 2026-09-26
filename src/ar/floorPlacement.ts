/**
 * A hit test is a surface observation, not a floor classification. These gates
 * only qualify a nearby, approximately horizontal candidate for the visitor to
 * confirm. Even a table can pass; the confirmation is deliberately required.
 * Thresholds are conservative starting values, not handset accuracy claims.
 */
const MIN_DROP_METERS = 0.25;
const MAX_DROP_METERS = 2.5;
const MAX_DISTANCE_METERS = 4;
const MIN_UP_NORMAL = Math.cos((10 * Math.PI) / 180);
const STABLE_MS = 500;
const MIN_SAMPLES = 6;
const MAX_GAP_MS = 250;
const HEIGHT_TOLERANCE_METERS = 0.03;
const TARGET_TOLERANCE_METERS = 0.15;

interface Point {
  x: number;
  y: number;
  z: number;
}

interface Candidate extends Point {
  origin: Point;
  since: number;
  at: number;
  samples: number;
}

export class FloorPlacement {
  private sample: Candidate | null = null;
  private confirmed: number | null = null;

  get confirmedY() {
    return this.confirmed;
  }

  get hits() {
    return this.sample?.samples ?? 0;
  }

  reset() {
    this.sample = null;
    this.confirmed = null;
  }

  /** The matrix's local +Y is the surface normal in WebXR hit-test poses. */
  observe(matrix: ArrayLike<number> | null, viewer: Point, nowMs: number) {
    // Once confirmed, looking at another surface must not lift the route onto it.
    if (this.confirmed !== null) return;
    if (
      matrix === null ||
      matrix.length !== 16 ||
      !Array.from(matrix).every(Number.isFinite) ||
      ![viewer.x, viewer.y, viewer.z, nowMs].every(Number.isFinite)
    ) {
      this.sample = null;
      return;
    }
    const point = { x: matrix[12], y: matrix[13], z: matrix[14] };
    const normalLength = Math.hypot(matrix[4], matrix[5], matrix[6]);
    const drop = viewer.y - point.y;
    if (
      normalLength < 0.99 ||
      normalLength > 1.01 ||
      matrix[5] / normalLength < MIN_UP_NORMAL ||
      drop < MIN_DROP_METERS ||
      drop > MAX_DROP_METERS ||
      Math.hypot(point.x - viewer.x, drop, point.z - viewer.z) > MAX_DISTANCE_METERS
    ) {
      this.sample = null;
      return;
    }
    const old = this.sample;
    if (
      old === null ||
      nowMs <= old.at ||
      nowMs - old.at > MAX_GAP_MS ||
      Math.abs(point.y - old.origin.y) > HEIGHT_TOLERANCE_METERS ||
      Math.hypot(point.x - old.origin.x, point.z - old.origin.z) > TARGET_TOLERANCE_METERS
    ) {
      this.sample = { ...point, origin: point, since: nowMs, at: nowMs, samples: 1 };
      return;
    }
    this.sample = {
      ...old,
      x: point.x,
      y: old.y + (point.y - old.y) / (old.samples + 1),
      z: point.z,
      at: nowMs,
      samples: old.samples + 1,
    };
  }

  candidate(nowMs: number) {
    const sample = this.sample;
    if (
      sample === null ||
      !Number.isFinite(nowMs) ||
      nowMs < sample.at ||
      nowMs - sample.at > MAX_GAP_MS
    )
      return null;
    return {
      x: sample.x,
      y: sample.y,
      z: sample.z,
      ready: sample.samples >= MIN_SAMPLES && sample.at - sample.since >= STABLE_MS,
    };
  }

  confirm(nowMs: number): boolean {
    const candidate = this.candidate(nowMs);
    if (this.confirmed !== null || !candidate?.ready) return false;
    this.confirmed = candidate.y;
    return true;
  }
}
