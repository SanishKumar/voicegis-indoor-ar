/**
 * Turning a scanned code into "you are here".
 *
 * This is the whole point of a check-in: a visitor holds a phone up to a sign
 * and the app places them at the anchor the package declares, with no beacons,
 * no RF fingerprinting and no lookup service. Everything it needs already ships
 * inside the compiled venue package — the anchors carry a declared position,
 * floor and payload — so a check-in resolves against data hashed at compile
 * time without a network round-trip.
 *
 * It is not survey-free, and the position is only as true as the sign's
 * placement. Somebody still has to measure where each code goes and hang it
 * there; nothing in this file can tell a correctly placed sign from one moved a
 * corridor to the left. That is the assumption the whole feature rests on, and
 * it is a physical one.
 *
 * Deliberately separate from `checkpoints.ts` in localization-core. That adapter
 * resolves scans into *observations* for the evidence pipeline, which cares
 * about accuracy, independence and survey provenance. This answers a much
 * smaller product question — which routing node should the next route start
 * from — and mixing the two would let a wayfinding convenience quietly become
 * an input to a published figure.
 */

export interface AnchorLike {
  id: string;
  floorId: string;
  kind: string;
  position: [number, number];
  headingDegrees: number;
  payload: string;
  /** The space the sign hangs in, when the package names one. */
  spaceId?: string;
}

export interface RoutingNodeLike {
  id: string;
  floorId: string;
  position: [number, number];
}

export type CheckInFailure =
  /** Nothing in this venue publishes that payload. */
  | 'unknown-code'
  /** The payload names an anchor that is not a scannable code. */
  | 'not-a-checkin-code'
  /** The anchor's floor has no routable node, so no route could start here. */
  | 'no-node-on-floor';

export type CheckIn =
  | { ok: true; anchor: AnchorLike; nodeId: string; distanceMeters: number }
  | { ok: false; reason: CheckInFailure };

/**
 * The anchor kinds a camera can actually read.
 *
 * An `image` or `apriltag` anchor is a distinct declared marker, and a QR code
 * encoding its payload is not that marker. Accepting it would let a printed
 * sticker stand in for a fixture nobody put up or checked.
 */
const SCANNABLE_KINDS = ['qr'];

/**
 * Resolves a scanned payload against a venue's anchors and routing graph.
 *
 * Exact payload match only. Prefix or fuzzy matching would let one venue's
 * codes resolve inside another, and the payloads are already namespaced per
 * venue precisely so they cannot collide.
 */
export function checkInFromScan(
  payload: string,
  anchors: readonly AnchorLike[],
  nodes: readonly RoutingNodeLike[],
): CheckIn {
  const wanted = payload.trim();
  if (wanted === '') return { ok: false, reason: 'unknown-code' };

  const anchor = anchors.find((candidate) => candidate.payload === wanted);
  if (anchor === undefined) return { ok: false, reason: 'unknown-code' };
  if (!SCANNABLE_KINDS.includes(anchor.kind)) {
    return { ok: false, reason: 'not-a-checkin-code' };
  }

  let best: RoutingNodeLike | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (node.floorId !== anchor.floorId) continue;
    const distance = Math.hypot(
      node.position[0] - anchor.position[0],
      node.position[1] - anchor.position[1],
    );
    // Ties broken by id so the same scan always produces the same route, rather
    // than depending on the order the package happened to serialise nodes in.
    if (distance < bestDistance || (distance === bestDistance && best !== null && node.id < best.id)) {
      best = node;
      bestDistance = distance;
    }
  }

  if (best === null) return { ok: false, reason: 'no-node-on-floor' };
  return { ok: true, anchor, nodeId: best.id, distanceMeters: bestDistance };
}

/** Every anchor in a venue that a printed code could legitimately encode. */
export function scannableAnchors(anchors: readonly AnchorLike[]): AnchorLike[] {
  return anchors.filter((anchor) => SCANNABLE_KINDS.includes(anchor.kind));
}

/** What a completed check-in remembers, for showing the visitor where they are. */
export interface CheckInRecord {
  anchorId: string;
  floorId: string;
  spaceId?: string;
  nodeId: string;
  distanceMeters: number;
}

export interface CheckInLabel {
  place: string;
  detail: string;
}

/**
 * Turns a check-in into something worth reading on screen.
 *
 * The anchor id is always in the detail line, never omitted as clutter, because
 * space names do not identify a code: Asterion hangs `anchor-g-east` and
 * `anchor-g-west` at opposite ends of one space called Central Concourse, so a
 * label naming only the space would read identically at both and a visitor
 * could not tell a mis-scan from a correct one.
 *
 * Lookups are passed in rather than reached for, so this stays testable without
 * a compiled package and cannot start depending on venue internals.
 */
export function describeCheckIn(
  record: CheckInRecord,
  names: { space(id: string): string | null; floor(id: string): string | null },
): CheckInLabel {
  const spaceName = record.spaceId ? names.space(record.spaceId) : null;
  const floorName = names.floor(record.floorId);

  // Falling back to the floor as the place would otherwise print it twice.
  const place = spaceName ?? floorName ?? 'a check-in point';
  const parts = spaceName === null ? [] : floorName === null ? [] : [floorName];
  parts.push(record.anchorId);

  return { place, detail: parts.join(' · ') };
}
