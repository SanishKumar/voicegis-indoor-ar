import { describe, expect, it } from 'vitest';
import { CheckpointAdapter, type CheckpointAnchor } from './checkpoints';
import { LocalizationFilter } from './filter';

const anchors: CheckpointAnchor[] = [
  {
    id: 'entry-anchor',
    floorId: 'g',
    kind: 'qr',
    position: [2, 2],
    headingDegrees: 90,
    payload: 'vg:entry-anchor',
  },
  {
    id: 'gallery-anchor',
    floorId: 'g',
    kind: 'nfc',
    position: [6, 6],
    headingDegrees: 270,
    payload: 'vg:gallery-anchor',
  },
];

describe('QR and NFC checkpoint adapter', () => {
  it('turns the first scan into the initial fix the filter requires', () => {
    const adapter = new CheckpointAdapter(anchors, { elevationByFloorId: { g: 0 } });
    const resolution = adapter.resolve({ timeMs: 1_000, kind: 'qr', payload: 'vg:entry-anchor' });

    expect(resolution.accepted).toBe(true);
    expect(resolution.anchorId).toBe('entry-anchor');
    expect(resolution.observations).toEqual([
      expect.objectContaining({
        kind: 'initial-fix',
        source: 'manual-anchor',
        position: [2, 2],
        floorId: 'g',
        headingDegrees: 90,
      }),
    ]);
    expect(adapter.hasFix).toBe(true);
  });

  it('corrects position, heading, and floor on every later scan', () => {
    const adapter = new CheckpointAdapter(anchors, { elevationByFloorId: { g: 0 } });
    adapter.resolve({ timeMs: 1_000, kind: 'qr', payload: 'vg:entry-anchor' });
    const second = adapter.resolve({ timeMs: 9_000, kind: 'nfc', payload: 'vg:gallery-anchor' });

    expect(second.observations.map((o) => o.kind)).toEqual(['position-fix', 'heading', 'floor']);
    // NFC couples within centimetres, so its fix must be tighter than QR.
    const fix = second.observations[0] as { accuracyMeters: number };
    expect(fix.accuracyMeters).toBeLessThan(0.35);
  });

  it('refuses a payload it cannot resolve to exactly one anchor', () => {
    const ambiguous = new CheckpointAdapter([
      ...anchors,
      { ...anchors[0], id: 'duplicate-anchor', position: [9, 9] },
    ]);

    expect(ambiguous.resolve({ timeMs: 1, kind: 'qr', payload: 'vg:entry-anchor' })).toMatchObject({
      accepted: false,
      reason: 'ambiguous-payload',
      observations: [],
    });
    expect(
      new CheckpointAdapter(anchors).resolve({ timeMs: 1, kind: 'qr', payload: 'vg:nope' }),
    ).toMatchObject({ accepted: false, reason: 'unknown-payload' });
  });

  it('refuses a scan whose transport does not match the anchor', () => {
    const adapter = new CheckpointAdapter(anchors);
    // A printed QR must not satisfy an NFC tap.
    const mismatch = adapter.resolve({ timeMs: 1, kind: 'qr', payload: 'vg:gallery-anchor' });

    expect(mismatch).toMatchObject({ accepted: false, reason: 'anchor-kind-mismatch' });
    expect(adapter.hasFix).toBe(false);
  });

  it('drives the existing filter without any adapter-specific handling', () => {
    const adapter = new CheckpointAdapter(anchors, { elevationByFloorId: { g: 0 } });
    const filter = new LocalizationFilter();

    let estimate = null;
    for (const scan of [
      { timeMs: 1_000, kind: 'qr' as const, payload: 'vg:entry-anchor' },
      { timeMs: 9_000, kind: 'nfc' as const, payload: 'vg:gallery-anchor' },
    ]) {
      for (const observation of adapter.resolve(scan).observations) {
        estimate = filter.apply(observation);
      }
    }

    expect(estimate).not.toBeNull();
    // The second checkpoint should pull the estimate onto the second anchor.
    expect(estimate!.position[0]).toBeCloseTo(6, 1);
    expect(estimate!.position[1]).toBeCloseTo(6, 1);
    expect(estimate!.observationSources).toContain('manual-anchor');
  });

  it('numbers observations continuously so a recording stays ordered', () => {
    const adapter = new CheckpointAdapter(anchors, {}, 40);
    const first = adapter.resolve({ timeMs: 1, kind: 'qr', payload: 'vg:entry-anchor' });
    const second = adapter.resolve({ timeMs: 2, kind: 'nfc', payload: 'vg:gallery-anchor' });

    expect([...first.observations, ...second.observations].map((o) => o.sequence)).toEqual([
      40, 41, 42, 43,
    ]);
    expect(adapter.nextSequence).toBe(44);
  });
});
