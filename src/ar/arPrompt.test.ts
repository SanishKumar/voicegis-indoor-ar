import { describe, expect, it } from 'vitest';
import type { TrackerSnapshot } from '../navigation/liveTracker';
import { arPrompt, type ArPromptInput } from './arPrompt';
import type { ArFrameReport } from './arSession';

function snapshot(overrides: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
  return {
    tier: 'tracking',
    reason: 'following',
    progressMeters: 4,
    sigmaMeters: 1.2,
    floorId: 'g',
    headingDegrees: 90,
    relativeHeadingDegrees: null,
    headingEpoch: 0,
    displacementAttached: true,
    walkedSinceAnchorMeters: 4,
    stridesSinceAnchor: 0,
    strideMeters: 0.72,
    lastMotionMs: 0,
    pendingFloor: null,
    moving: true,
    ...overrides,
  };
}
function report(overrides: Partial<ArFrameReport> = {}): ArFrameReport {
  return {
    aligned: true,
    recovery: null,
    placement: null,
    floorY: 0,
    floorHits: 3,
    facingDegrees: 90,
    progressMeters: 4,
    ...overrides,
  };
}
function prompt(overrides: Partial<ArPromptInput> = {}) {
  return arPrompt({
    report: report(),
    snapshot: snapshot(),
    arrived: false,
    atEnd: false,
    floorName: (id) => (id === '1' ? 'Level 1' : undefined),
    ...overrides,
  });
}

describe('what the AR view asks of the visitor', () => {
  it('stays out of the way while the route leads on', () => {
    expect(prompt()).toEqual({
      kind: 'guiding',
      note: null,
      action: { kind: 'realign', label: 'Re-align' },
      leads: null,
    });
  });

  it('says what placing the route is waiting for, without calling it lost', () => {
    const first = prompt({ report: null });
    expect(first.kind).toBe('tracking');
    expect(prompt({ report: report({ aligned: false, placement: 'steady' }) }).note).toMatch(
      /hold the phone still/i,
    );
    const floor = prompt({ report: report({ aligned: false, placement: 'floor' }) });
    expect(floor.kind).toBe('floor');
    expect(floor.note).toMatch(/at the floor/i);
    expect(floor.leads).toBeNull();
  });

  it('asks for re-alignment when the phone loses the room', () => {
    const lost = prompt({ report: report({ aligned: false, recovery: 'pose-lost' }) });
    expect(lost.kind).toBe('pose-lost');
    expect(lost.action?.kind).toBe('realign');
    expect(lost.leads).toBe('action');
  });

  it('asks for the storey change at a lift, naming the floor, even while the room is lost', () => {
    const lift = prompt({
      report: report({ aligned: false, recovery: 'pose-lost' }),
      snapshot: snapshot({
        tier: 'frozen',
        reason: 'floor-change',
        pendingFloor: { toFloorId: '1', alightingMeters: 16 },
      }),
    });
    expect(lift.kind).toBe('floor-change');
    expect(lift.action).toEqual({ kind: 'confirm-floor', label: 'I’m on Level 1' });
    expect(lift.note).toContain('Level 1');
    expect(lift.leads).toBe('action');
  });

  it('offers to confirm arrival at the end of the route, then only to leave', () => {
    const end = prompt({ snapshot: snapshot({ reason: 'arrived', progressMeters: 20 }) });
    expect(end.action?.kind).toBe('confirm-arrival');
    expect(prompt({ atEnd: true, snapshot: null }).kind).toBe('arriving');
    expect(prompt({ arrived: true })).toEqual({
      kind: 'arrived',
      note: null,
      action: null,
      leads: 'leave',
    });
  });

  it('sends the visitor to scan where re-aligning cannot fix the position', () => {
    for (const reason of ['off-route', 'uncertain'] as const) {
      const frozen = prompt({ snapshot: snapshot({ tier: 'frozen', reason }) });
      expect(frozen.kind).toBe('rescan');
      expect(frozen.action).toBeNull();
      expect(frozen.leads).toBe('leave');
      expect(frozen.note).toMatch(/scan a check-in code/);
    }
  });

  it('names a floor change the session noticed on its own', () => {
    expect(prompt({ report: report({ aligned: false, recovery: 'floor-change' }) }).kind).toBe(
      'new-floor',
    );
  });

  it('tells the visitor when they are walking away from the route', () => {
    expect(prompt({ snapshot: snapshot({ tier: 'caution', reason: 'wrong-way' }) }).kind).toBe(
      'wrong-way',
    );
  });
});
