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
    canStartPose: true,
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
    floorName: (id) => (id === '1' ? 'Level 1' : undefined),
    ...overrides,
  });
}

describe('what the AR view asks of the visitor', () => {
  it('distinguishes a confirmed floor from an unavailable building direction', () => {
    const waiting = prompt({ report: report({ aligned: false, placement: 'heading' }) });
    expect(waiting.kind).toBe('heading');
    expect(waiting.note).toMatch(/does not know which way you are facing/);
    expect(waiting.note).toMatch(/scan a check-in sign/);
    expect(waiting.leads).toBe('leave');
    expect(waiting.action).toBeNull();
    expect(waiting.note).not.toMatch(/face.*route/i);
  });
  it('points the way to a route placed beside or behind the camera', () => {
    expect(prompt({ turnDegrees: 170 })).toMatchObject({
      kind: 'turn-around',
      note: 'The route is behind you. Turn around.',
    });
    expect(prompt({ turnDegrees: -130 }).kind).toBe('turn-around');
    expect(prompt({ turnDegrees: 70 }).note).toBe('Turn right to see the route.');
    expect(prompt({ turnDegrees: -70 }).note).toBe('Turn left to see the route.');
    // Within the view, or unknown, there is nothing to say.
    expect(prompt({ turnDegrees: 30 }).kind).toBe('guiding');
    expect(prompt({ turnDegrees: null }).kind).toBe('guiding');
    // A lost room or a lift matters more than where the camera points.
    expect(
      prompt({ turnDegrees: 170, report: report({ aligned: false, recovery: 'pose-lost' }) }).kind,
    ).toBe('pose-lost');
  });

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

  it('requires an explicit surface confirmation and offers an exit when detection is unavailable', () => {
    const candidate = prompt({
      report: report({ aligned: false, placement: 'floor-confirm', floorY: null }),
    });
    expect(candidate.action).toEqual({ kind: 'confirm-surface', label: 'This is the floor' });
    expect(candidate.note).toMatch(/not furniture/);
    expect(candidate.leads).toBe('action');
    const unavailable = prompt({
      report: report({ aligned: false, placement: 'floor-unavailable', floorY: null }),
    });
    expect(unavailable.action).toBeNull();
    expect(unavailable.leads).toBe('leave');
    expect(unavailable.note).toMatch(/cannot be placed/);
    expect(prompt({ report: report({ aligned: false, placement: 'floor' }) }).action).toBeNull();
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
    expect(prompt({ arrived: true })).toEqual({
      kind: 'arrived',
      note: null,
      action: null,
      leads: 'leave',
    });
  });

  it('takes arrival only from the physical tracker, never from what the screen shows', () => {
    // A walk-through preview can have the screen at the destination while the
    // visitor still stands at the check-in point and the route is being placed.
    const placing = report({ aligned: false, placement: 'steady', progressMeters: 0 });
    expect(prompt({ report: placing, snapshot: snapshot({ progressMeters: 0 }) }).kind).toBe(
      'steady',
    );
    expect(prompt({ report: placing, snapshot: null }).action?.kind).not.toBe('confirm-arrival');
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
