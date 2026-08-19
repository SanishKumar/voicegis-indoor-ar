import { describe, expect, it } from 'vitest';
import {
  checkInFromScan,
  describeCheckIn,
  scannableAnchors,
  type AnchorLike,
  type RoutingNodeLike,
} from './anchorCheckIn';

/**
 * Check-in is the moment the product stops being a map and starts being
 * navigation: a stranger points a phone at a sign and gets routed. These cover
 * the ways a scan can be wrong, because every one of them is something a
 * visitor will do by accident.
 */

const anchors: AnchorLike[] = [
  {
    id: 'anchor-g-west',
    floorId: 'g',
    kind: 'qr',
    position: [12, 24],
    headingDegrees: 90,
    payload: 'voicegis://asterion/g/west',
  },
  {
    id: 'anchor-l1-west',
    floorId: 'l1',
    kind: 'qr',
    position: [12, 24],
    headingDegrees: 90,
    payload: 'voicegis://asterion/l1/west',
  },
  {
    id: 'anchor-g-entry',
    floorId: 'g',
    kind: 'apriltag',
    position: [6, 24],
    headingDegrees: 90,
    payload: 'voicegis://asterion/g/entry',
  },
];

const nodes: RoutingNodeLike[] = [
  { id: 'g-near', floorId: 'g', position: [13, 24] },
  { id: 'g-far', floorId: 'g', position: [40, 24] },
  { id: 'l1-near', floorId: 'l1', position: [12, 25] },
];

describe('resolving a scanned code to a starting point', () => {
  it('lands on the nearest routable node on the anchor floor', () => {
    const result = checkInFromScan('voicegis://asterion/g/west', anchors, nodes);

    expect(result).toMatchObject({ ok: true, nodeId: 'g-near', distanceMeters: 1 });
  });

  it('never crosses floors, even when another floor is geometrically closer', () => {
    // The l1 anchor sits at the same x,y as the ground one. A nearest-node
    // search that ignored the floor would put a visitor one storey out, which
    // is the worst possible wayfinding error: confident and wrong.
    const result = checkInFromScan('voicegis://asterion/l1/west', anchors, nodes);

    expect(result).toMatchObject({ ok: true, nodeId: 'l1-near' });
  });

  it('refuses a code this venue does not publish', () => {
    expect(checkInFromScan('voicegis://elsewhere/g/west', anchors, nodes)).toEqual({
      ok: false,
      reason: 'unknown-code',
    });
  });

  it('refuses a payload that is not exactly an anchor payload', () => {
    // Prefix matching would let one venue's codes resolve inside another.
    expect(checkInFromScan('voicegis://asterion/g/we', anchors, nodes)).toMatchObject({
      ok: false,
      reason: 'unknown-code',
    });
    expect(checkInFromScan('voicegis://asterion/g/west/extra', anchors, nodes)).toMatchObject({
      ok: false,
      reason: 'unknown-code',
    });
  });

  it('refuses a printed code claiming to be an anchor that was never scannable', () => {
    // The apriltag anchor is a real surveyed point, but a QR sticker encoding
    // its payload is not the thing that was surveyed.
    expect(checkInFromScan('voicegis://asterion/g/entry', anchors, nodes)).toEqual({
      ok: false,
      reason: 'not-a-checkin-code',
    });
  });

  it('refuses when the anchor floor has nothing routable on it', () => {
    expect(
      checkInFromScan('voicegis://asterion/l1/west', anchors, [{ id: 'g-near', floorId: 'g', position: [13, 24] }]),
    ).toEqual({ ok: false, reason: 'no-node-on-floor' });
  });

  it('ignores whitespace a scanner may pad the payload with', () => {
    expect(checkInFromScan('  voicegis://asterion/g/west \n', anchors, nodes)).toMatchObject({
      ok: true,
      nodeId: 'g-near',
    });
  });

  it('treats an empty read as no code at all', () => {
    expect(checkInFromScan('   ', anchors, nodes)).toEqual({ ok: false, reason: 'unknown-code' });
  });
});

describe('which anchors deserve a printed code', () => {
  it('lists only the scannable ones', () => {
    expect(scannableAnchors(anchors).map((anchor) => anchor.id)).toEqual([
      'anchor-g-west',
      'anchor-l1-west',
    ]);
  });
});

describe('telling the visitor where they just checked in', () => {
  const names = {
    space: (id: string) => (id === 'g-concourse' ? 'Central Concourse' : null),
    floor: (id: string) => (id === 'g' ? 'Ground · Diagnostics' : null),
  };

  it('always names the anchor, because a space name can cover two codes', () => {
    // Asterion hangs anchor-g-east and anchor-g-west at opposite ends of one
    // space. A label naming only the space reads identically at both, so a
    // visitor could not tell a mis-scan from a correct one.
    const west = describeCheckIn(
      { anchorId: 'anchor-g-west', floorId: 'g', spaceId: 'g-concourse', nodeId: 'n1', distanceMeters: 1 },
      names,
    );
    const east = describeCheckIn(
      { anchorId: 'anchor-g-east', floorId: 'g', spaceId: 'g-concourse', nodeId: 'n2', distanceMeters: 1 },
      names,
    );

    expect(west.place).toBe('Central Concourse');
    expect(west.detail).toBe('Ground · Diagnostics · anchor-g-west');
    expect(east.detail).not.toBe(west.detail);
  });

  it('falls back to the floor as the place without printing it twice', () => {
    const label = describeCheckIn(
      { anchorId: 'anchor-g-west', floorId: 'g', nodeId: 'n1', distanceMeters: 1 },
      names,
    );

    expect(label.place).toBe('Ground · Diagnostics');
    expect(label.detail).toBe('anchor-g-west');
  });

  it('still says something when the package names neither', () => {
    const label = describeCheckIn(
      { anchorId: 'anchor-x', floorId: 'zz', nodeId: 'n1', distanceMeters: 1 },
      { space: () => null, floor: () => null },
    );

    expect(label).toEqual({ place: 'a surveyed point', detail: 'anchor-x' });
  });
});
