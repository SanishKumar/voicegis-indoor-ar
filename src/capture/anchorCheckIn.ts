/**
 * Turning a scanned code into "you are here".
 *
 * This is the whole point of a check-in: a visitor holds a phone up to a sign
 * and the app knows where they are, with no beacons, no site survey and no
 * connectivity. Everything it needs already ships inside the compiled venue
 * package — the anchors carry their surveyed position, floor and payload — so a
 * check-in resolves entirely offline against data that was hashed at compile
 * time.
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
 * An `image` or `apriltag` anchor is a real surveyed point, but a QR code
 * encoding its payload is not the thing that was surveyed. Accepting it would
 * mean a printed sticker could claim to be a wall sign nobody verified.
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
