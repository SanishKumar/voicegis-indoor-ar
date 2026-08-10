import { describe, expect, it } from 'vitest';
import {
  SessionRecorder,
  exportCaptureSession,
  importCaptureSession,
  validateCaptureSession,
  type CaptureDeviceProfile,
  type CaptureSession,
  type CheckpointAnchor,
} from './index';

/**
 * The boundary between a VenuePackage anchor and a capture anchor.
 *
 * A package anchor also carries `spaceId`, which anchor resolution,
 * localization and replay never read. Authorship normalises it away once, at
 * construction; validation then treats any anchor property the schema does not
 * define as an error rather than something to quietly remove.
 */

/** Shaped like a compiled VenuePackage anchor, including the extra field. */
const packageAnchor = {
  id: 'corridor-start',
  floorId: 'g',
  spaceId: 'g-corridor',
  kind: 'qr' as const,
  position: [1, 9] as [number, number],
  headingDegrees: 90,
  payload: 'vg:corridor-start',
};

const device: CaptureDeviceProfile = {
  label: 'field handset',
  platform: 'android',
  sensors: { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' },
};

function recorderWith(anchors: CheckpointAnchor[]) {
  return new SessionRecorder({
    sessionId: 'anchor-contract',
    buildingId: 'reference-medical-centre',
    packageHash: 'a'.repeat(64),
    device,
    anchors,
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
}

describe('capture anchor contract', () => {
  it('accepts a VenuePackage anchor that carries spaceId', () => {
    const recorder = recorderWith([packageAnchor as unknown as CheckpointAnchor]);
    // Resolution still works against the normalised snapshot.
    const scan = recorder.recordScan({
      timeMs: 100,
      transport: 'qr',
      payload: 'vg:corridor-start',
    });

    expect(scan.outcome).toBe('resolved');
    expect(scan.anchorId).toBe('corridor-start');
  });

  it('authors a session with no spaceId, and that session validates', () => {
    const session = recorderWith([
      packageAnchor as unknown as CheckpointAnchor,
    ]).buildSession();

    expect(Object.keys(session.anchors[0]).sort()).toEqual([
      'floorId',
      'headingDegrees',
      'id',
      'kind',
      'payload',
      'position',
    ]);
    expect(session.anchors[0]).not.toHaveProperty('spaceId');
    expect(validateCaptureSession(session)).toEqual([]);
    expect(importCaptureSession(exportCaptureSession(session)).valid).toBe(true);
  });

  it('rejects imported JSON whose anchor carries spaceId', () => {
    const session = recorderWith([
      packageAnchor as unknown as CheckpointAnchor,
    ]).buildSession();
    const smuggled = JSON.parse(exportCaptureSession(session)) as CaptureSession;
    (smuggled.anchors[0] as unknown as { spaceId: string }).spaceId = 'g-corridor';

    const result = importCaptureSession(JSON.stringify(smuggled));

    expect(result.valid).toBe(false);
    expect(result.session).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain('unknown-anchor-property');
  });

  it('fails export rather than sanitising an anchor field added after authorship', () => {
    const session = recorderWith([
      packageAnchor as unknown as CheckpointAnchor,
    ]).buildSession();
    (session.anchors[0] as unknown as { spaceId: string }).spaceId = 'g-corridor';

    // Silently dropping it would produce a file that looks authored but is not
    // what the caller handed over.
    expect(() => exportCaptureSession(session)).toThrow('Refusing to export');
    expect(validateCaptureSession(session).map((issue) => issue.code)).toContain(
      'unknown-anchor-property',
    );
  });

  it('keeps the snapshot stable when the original anchor is mutated afterwards', () => {
    const mutable = {
      ...packageAnchor,
      position: [1, 9] as [number, number],
    };
    const recorder = recorderWith([mutable as unknown as CheckpointAnchor]);

    // The caller edits its own anchor after handing it over.
    mutable.payload = 'vg:something-else';
    mutable.headingDegrees = 270;
    mutable.position[0] = 999;

    const session = recorder.buildSession();
    expect(session.anchors[0]).toMatchObject({
      payload: 'vg:corridor-start',
      headingDegrees: 90,
      position: [1, 9],
    });
    // Resolution uses the snapshot too, not the caller's edited object.
    expect(
      recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' }).outcome,
    ).toBe('resolved');
  });
});
