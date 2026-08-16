import { describe, expect, it } from 'vitest';
import * as pkg from './index';
// Imported from the module rather than the barrel, which does not carry it.
import { decodeEvidenceArtifact } from './evidenceArtifact';
import {
  CHECKPOINT_MANIFEST_VERSION,
  EVIDENCE_ARTIFACT_VERSION,
  SessionRecorder,
  buildEvidenceReport,
  exportEvidenceArtifact,
  importEvidenceArtifact,
  sealEvidenceArtifact,
  validateCaptureSession,
  validateCheckpointManifest,
  verifyEvidenceArtifact,
  DEFAULT_CHECKPOINT_CONFIG,
  DEFAULT_DEAD_RECKONING_CONFIG,
  DEFAULT_LOCALIZATION_FILTER_CONFIG,
  LocalizationFilter,
  type CaptureDeviceProfile,
  type CaptureSession,
  type CheckpointAnchor,
  type CheckpointManifest,
  type CheckpointManifestEntry,
  type EvidenceArtifact,
} from './index';

/**
 * A figure that cannot be reproduced from named inputs is an assertion, not
 * evidence. The artifact exists to name those inputs — which capture, which
 * venue package, which predeclared checkpoints, which processor, policy and
 * resolved configuration — and to seal the result so any change to any of them
 * is visible.
 *
 * Integrity and reproducibility only. Nothing here says who authored a walk;
 * that needs a signature and is deliberately outside v0.1.
 */

const device: CaptureDeviceProfile = {
  label: 'field handset',
  platform: 'android',
  sensors: { api: 'native', gyroscopeUnits: 'deg/s', frame: 'world' },
};

const anchors: CheckpointAnchor[] = [
  {
    id: 'corridor-start',
    floorId: 'g',
    kind: 'qr',
    position: [1, 9],
    headingDegrees: 90,
    payload: 'vg:corridor-start',
  },
];

const PACKAGE_HASH = 'a'.repeat(64);

interface WalkOptions {
  packageHash?: string;
  markPosition?: [number, number];
  peakAt?: number;
  sessionId?: string;
  surveyMethod?: 'tape-measure' | 'laser-distance' | 'total-station' | 'estimated';
  expectedAccuracyMeters?: number;
  independentOfAnchors?: boolean;
}

/** The same walk every time unless an argument says otherwise. */
function walk(options: WalkOptions = {}): CaptureSession {
  const recorder = new SessionRecorder({
    sessionId: options.sessionId ?? 'sealed-walk',
    buildingId: 'reference-medical-centre',
    packageHash: options.packageHash ?? PACKAGE_HASH,
    device,
    anchors,
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
  recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
  for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
    recorder.recordImu({
      timeMs,
      accelerometer: [
        0,
        0,
        timeMs === options.peakAt ? 12 : 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500),
      ],
      gyroscope: [0, 0, 0],
    });
  }
  recorder.recordGroundTruth({
    timeMs: 3_000,
    checkpointId: 'mark',
    position: options.markPosition ?? [3.5, 9],
    floorId: 'g',
    surveyMethod: options.surveyMethod ?? 'tape-measure',
    expectedAccuracyMeters: options.expectedAccuracyMeters ?? 0.03,
    independentOfAnchors: options.independentOfAnchors ?? true,
  });
  recorder.recordLifecycle('session-end', 3_100);
  return recorder.buildSession();
}


/** The standard walk, with an extra event recorded at its chronological place. */
function completeWalkWith(during: (recorder: SessionRecorder) => void): CaptureSession {
  const recorder = new SessionRecorder({
    sessionId: 'sealed-walk',
    buildingId: 'reference-medical-centre',
    packageHash: PACKAGE_HASH,
    device,
    anchors,
    startedAtIso: '2026-08-07T09:00:00.000Z',
  });
  recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
  for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
    if (timeMs === 2_000) during(recorder);
    recorder.recordImu({
      timeMs,
      accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
      gyroscope: [0, 0, 0],
    });
  }
  recorder.recordGroundTruth({
    timeMs: 3_000,
    checkpointId: 'mark',
    position: [3.5, 9],
    floorId: 'g',
    surveyMethod: 'tape-measure',
    expectedAccuracyMeters: 0.03,
    independentOfAnchors: true,
  });
  recorder.recordLifecycle('session-end', 3_100);
  return recorder.buildSession();
}

function manifest(overrides: Partial<CheckpointManifest> = {}): CheckpointManifest {
  return {
    manifestVersion: CHECKPOINT_MANIFEST_VERSION,
    buildingId: 'reference-medical-centre',
    packageHash: PACKAGE_HASH,
    checkpoints: [{ id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true }],
    ...overrides,
  };
}

async function seal(session = walk(), declared = manifest()) {
  const result = await sealEvidenceArtifact(session, declared);
  if (result.sealed === null) {
    throw new Error(`expected a sealed artifact, got ${JSON.stringify(result.refusals)}`);
  }
  return result.sealed;
}

describe('sealing is deterministic', () => {
  it('produces identical bytes from identical inputs', async () => {
    const first = await seal();
    const second = await seal();

    expect(await exportEvidenceArtifact(second)).toBe(await exportEvidenceArtifact(first));
    expect(second.contentHash).toBe(first.contentHash);
    // Determinism has to survive a fresh recorder, not just a reused object.
    expect(second).not.toBe(first);
  });

  it('carries no clock of its own', async () => {
    // A sealing timestamp would make every artifact unique and reproducibility
    // unprovable. The capture's own start time is recorded instead.
    const exported = await exportEvidenceArtifact(await seal());

    expect(exported).toContain('"startedAtIso": "2026-08-07T09:00:00.000Z"');
    expect(exported).not.toMatch(/"sealedAt/);
  });

  it('round-trips through export and import unchanged', async () => {
    const sealed = await seal();
    const imported = await importEvidenceArtifact(await exportEvidenceArtifact(sealed));

    expect(imported.valid).toBe(true);
    expect(imported.artifact).toEqual(sealed);
    expect(await exportEvidenceArtifact(imported.artifact!)).toBe(await exportEvidenceArtifact(sealed));
  });
});

describe('the artifact names its inputs without republishing them', () => {
  it('records hashes of the walk rather than the walk itself', async () => {
    const exported = await exportEvidenceArtifact(await seal());

    // A capture holds raw inertial samples and scan payloads from a real
    // building. None of that is carried into whatever the artifact is shown to.
    for (const key of ['"accelerometer"', '"gyroscope"', '"events"', '"anchors"', '"orientation"']) {
      expect(exported, key).not.toContain(key);
    }
    // Nor the payloads a scan read, which name real markers in a real building.
    expect(exported).not.toContain('vg:corridor-start');

    // `gyroscopeUnits` is the declared sensor model, not a sample: the artifact
    // has to say which units the policy accepts without carrying any readings.
    expect(exported).toContain('"gyroscopeUnits": "deg/s"');
  });

  it('is not anonymous, and does not pretend to be', async () => {
    const sealed = await seal();

    // Withholding the raw walk is not the same as withholding identity. An
    // artifact names the session, the building, the venue package, when the
    // walk began, and how long it was — and sampling gaps carry timestamps
    // from the walk itself. Anyone handed one learns that a particular walk
    // happened in a particular building at a particular time.
    expect(sealed.capture.sessionId).toBe('sealed-walk');
    expect(sealed.capture.buildingId).toBe('reference-medical-centre');
    expect(sealed.capture.startedAtIso).toBe('2026-08-07T09:00:00.000Z');
    expect(sealed.capture.eventCount).toBeGreaterThan(0);
    expect(sealed.venue.packageHash).toBe(PACKAGE_HASH);
    expect(sealed.evidence.sampling).toHaveProperty('gaps');
  });

  it('records the versions a reader needs to interpret it', async () => {
    const sealed = await seal();

    expect(sealed.artifactVersion).toBe(EVIDENCE_ARTIFACT_VERSION);
    // Pinned as literals on purpose. Reading the constants here would let a
    // version change through silently, and these numbers are how a reader tells
    // a figure produced by one processor from a figure produced by another.
    expect(sealed.versions).toMatchObject({
      processor: '0.2.0',
      policy: '0.2.0',
      captureStream: '0.2.0',
      recording: '0.1.0',
    });
  });

  it('records the venue package and the capture it came from', async () => {
    const sealed = await seal();

    expect(sealed.venue.packageHash).toBe(PACKAGE_HASH);
    expect(sealed.capture.sessionId).toBe('sealed-walk');
    expect(sealed.capture.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.manifest.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.manifest).toMatchObject({ scoredCount: 1, diagnosticCount: 0 });
  });

  it('records the figure alongside the status that qualifies it', async () => {
    const sealed = await seal();

    expect(sealed.evidence.status).toBe('ok');
    expect(sealed.evidence.medianHorizontalErrorMeters).toBeCloseTo(3.688, 3);
    expect(sealed.evidence.eligibility).toMatchObject({ surveyed: 1, publishable: 1, excluded: 0 });
  });

  it('seals a walk that produced no figure, and says why', async () => {
    // The least flattering outcomes are the ones most worth documenting.
    // Refusing to seal them would leave only the good walks on record.
    const unsupported = new SessionRecorder({
      sessionId: 'sealed-walk',
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      device: { ...device, sensors: { ...device.sensors, frame: 'device' } },
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });
    unsupported.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    unsupported.recordImu({ timeMs: 100, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    unsupported.recordGroundTruth({
      timeMs: 200,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    unsupported.recordLifecycle('session-end', 300);

    const sealed = await seal(unsupported.buildSession());
    expect(sealed.evidence.status).toBe('unsupported-sensor-model');
    expect(sealed.evidence.medianHorizontalErrorMeters).toBeNull();
    expect((await verifyEvidenceArtifact(sealed)).valid).toBe(true);
  });
});

describe('every input is bound into the seal', () => {
  it('changes the hash when any capture event changes', async () => {
    const baseline = await seal();
    const changed = await seal(walk({ peakAt: 1_500 }));

    expect(changed.capture.contentHash).not.toBe(baseline.capture.contentHash);
    expect(changed.contentHash).not.toBe(baseline.contentHash);
  });

  it('changes the hash when the venue package changes', async () => {
    const baseline = await seal();
    const otherVenue = 'b'.repeat(64);
    const changed = await seal(
      walk({ packageHash: otherVenue }),
      manifest({ packageHash: otherVenue }),
    );

    expect(changed.venue.packageHash).not.toBe(baseline.venue.packageHash);
    expect(changed.contentHash).not.toBe(baseline.contentHash);
  });

  it('changes the hash when the checkpoint manifest changes', async () => {
    const baseline = await seal();

    // Same walk, same marks — only the predeclared role differs. This is the
    // relabelling the manifest exists to make visible.
    const relabelled = await seal(
      walk(),
      manifest({
        checkpoints: [{ id: 'mark', position: [3.5, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true }],
      }),
    );

    expect(relabelled.manifest.contentHash).not.toBe(baseline.manifest.contentHash);
    expect(relabelled.contentHash).not.toBe(baseline.contentHash);
  });

  it('is insensitive to the order the manifest happens to be written in', async () => {
    const twoMarks = (order: 'ab' | 'ba') =>
      manifest({
        checkpoints:
          order === 'ab'
            ? [
                { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
                { id: 'extra', position: [7, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
              ]
            : [
                { id: 'extra', position: [7, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
                { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
              ],
      });

    const session = (() => {
      const recorder = new SessionRecorder({
        sessionId: 'sealed-walk',
        buildingId: 'reference-medical-centre',
        packageHash: PACKAGE_HASH,
        device,
        anchors,
        startedAtIso: '2026-08-07T09:00:00.000Z',
      });
      recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
      for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
        recorder.recordImu({
          timeMs,
          accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
          gyroscope: [0, 0, 0],
        });
      }
      for (const [id, position] of [
        ['mark', [3.5, 9]],
        ['extra', [7, 9]],
      ] as Array<[string, [number, number]]>) {
        recorder.recordGroundTruth({
          timeMs: 3_000,
          checkpointId: id,
          position,
          floorId: 'g',
          surveyMethod: 'tape-measure',
          expectedAccuracyMeters: 0.03,
          independentOfAnchors: true,
        });
      }
      recorder.recordLifecycle('session-end', 3_100);
      return recorder.buildSession();
    })();

    const first = await seal(session, twoMarks('ab'));
    const second = await seal(session, twoMarks('ba'));

    // The manifest is a set of predeclarations, not a list, so writing it in a
    // different order must not look like a different manifest.
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('records the configuration the figure was actually produced with', async () => {
    const sealed = await seal();

    expect(sealed.configuration.deadReckoning.strideLengthMeters).toBe(0.72);
    expect(sealed.configuration.checkpoint.qrAccuracyMeters).toBe(0.35);
    expect(sealed.configuration.routeSegmentCount).toBe(0);
    expect(sealed.configuration.thresholds).toMatchObject({
      groundTruthAlignmentToleranceMs: 1_000,
      materialSensorGapMs: 1_000,
      minSampleIntervalMs: 0.001,
      maxBuildingFrameCoordinateMeters: 100_000,
      anchorIndependenceToleranceMeters: 1.5,
    });
  });

  it('records the policy as values, so a silent change to it is visible', async () => {
    const sealed = await seal();

    // Pinned deliberately. If a policy value moves without the policy version
    // moving with it, this fails and says so.
    expect(sealed.policy.publishableSurveyMethods).toEqual([
      'tape-measure',
      'laser-distance',
      'total-station',
    ]);
    expect(sealed.policy.maxPublishableSurveyAccuracyMeters).toBe(0.25);
    expect(sealed.policy.evidentialSensorModel).toEqual({
      api: 'native',
      frame: 'world',
      gyroscopeUnits: 'deg/s',
    });
  });
});

describe('the official path takes no tuning', () => {
  it('ignores the overrides the diagnostic path accepts', async () => {
    const session = walk();
    const sealed = await seal(session);

    // The same capture through the diagnostic path with a stride override
    // reports a different figure while still claiming ok. That is precisely why
    // nothing sealed may go through it.
    const bent = buildEvidenceReport(session, {
      deadReckoningConfig: { strideLengthMeters: 1.4 },
    });

    expect(bent.report.evidenceStatus).toBe('ok');
    expect(bent.report.medianHorizontalErrorMeters).not.toBe(
      sealed.evidence.medianHorizontalErrorMeters,
    );
    expect(bent.configuration.deadReckoning.strideLengthMeters).toBe(1.4);
    // The sealed artifact is unmoved by any of it.
    expect(sealed.configuration.deadReckoning.strideLengthMeters).toBe(0.72);
    expect(sealed.evidence.medianHorizontalErrorMeters).toBeCloseTo(3.688, 3);
  });

  it('exposes no way to pass tuning into sealing', () => {
    // A second argument would have to be the manifest; there is no third.
    expect(sealEvidenceArtifact.length).toBe(2);
  });
});

describe('verification detects a tampered artifact', () => {
  const tamper = async (mutate: (artifact: EvidenceArtifact) => void) => {
    const sealed = await seal();
    const forged = structuredClone(sealed) as EvidenceArtifact;
    mutate(forged);
    return verifyEvidenceArtifact(forged);
  };

  it('accepts an untouched artifact', async () => {
    const verification = await verifyEvidenceArtifact(await seal());
    expect(verification.valid).toBe(true);
  });

  it('rejects a rewritten figure', async () => {
    const verification = await tamper((artifact) => {
      artifact.evidence.medianHorizontalErrorMeters = 0.4;
    });

    expect(verification.valid).toBe(false);
    expect(verification.valid === false && verification.issues[0]).toMatch(/content hash/);
  });

  it('rejects a rewritten status, configuration, policy, or manifest hash', async () => {
    const mutations: Array<(artifact: EvidenceArtifact) => void> = [
      (artifact) => {
        artifact.evidence.status = 'ok';
        artifact.evidence.floorAccuracy = 1;
        artifact.evidence.checkpointCount = 99;
      },
      (artifact) => {
        artifact.configuration.deadReckoning.strideLengthMeters = 1.4;
      },
      (artifact) => {
        artifact.policy.maxPublishableSurveyAccuracyMeters = 5;
      },
      (artifact) => {
        artifact.manifest.contentHash = 'f'.repeat(64);
      },
      (artifact) => {
        artifact.capture.contentHash = 'f'.repeat(64);
      },
      (artifact) => {
        artifact.venue.packageHash = 'f'.repeat(64);
      },
      (artifact) => {
        artifact.versions.processor = '9.9.9' as typeof artifact.versions.processor;
      },
      (artifact) => {
        artifact.capture.eventCount += 1;
      },
    ];

    for (const mutate of mutations) {
      expect((await tamper(mutate)).valid).toBe(false);
    }
  });

  it('seals every section it carries, so nothing rides along unsealed', async () => {
    // A section left out of the hashed body would verify happily however it was
    // rewritten. Touching each top-level key in turn is what proves the seal
    // covers the whole document rather than the parts anyone remembered.
    const sealed = await seal();
    const sections = Object.keys(sealed).filter((key) => key !== 'contentHash');
    expect(sections.sort()).toEqual([
      'artifactVersion',
      'capture',
      'configuration',
      'evidence',
      'manifest',
      'policy',
      'venue',
      'versions',
    ]);

    for (const section of sections) {
      const forged = structuredClone(sealed) as unknown as Record<string, unknown>;
      forged[section] = typeof forged[section] === 'string' ? 'rewritten' : { rewritten: true };
      const verification = await verifyEvidenceArtifact(forged as unknown as EvidenceArtifact);
      expect(verification.valid, section).toBe(false);
    }
  });

  it('refuses an artifact whose version it does not understand', async () => {
    const verification = await tamper((artifact) => {
      (artifact as { artifactVersion: string }).artifactVersion = '9.9.9';
    });

    expect(verification.valid).toBe(false);
    expect(verification.valid === false && verification.issues[0]).toMatch(/artifactVersion/);
  });

  it('refuses text that is not an artifact at all', async () => {
    expect((await importEvidenceArtifact('{oh no')).valid).toBe(false);
    expect((await importEvidenceArtifact('[]')).valid).toBe(false);
    expect((await importEvidenceArtifact('null')).valid).toBe(false);
  });
});

describe('a capture and its manifest must describe the same walk', () => {
  const refusalsFor = async (session: CaptureSession, declared: CheckpointManifest) => {
    const result = await sealEvidenceArtifact(session, declared);
    expect(result.sealed).toBeNull();
    return result.refusals.map((refusal) => refusal.reason);
  };

  it('refuses a mark that was never predeclared', async () => {
    expect(
      await refusalsFor(walk(), manifest({ checkpoints: [] })),
    ).toContain('unmanifested-checkpoint');
  });

  it('seals a walk that fell short of its manifest rather than refusing it', async () => {
    // Refusing suppressed the failure: the walk that missed a mark produced no
    // artifact at all, so only the walks that went well left a record.
    const result = await sealEvidenceArtifact(
      walk(),
      manifest({
        checkpoints: [
          { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
          { id: 'never-walked', position: [9, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
        ],
      }),
    );

    expect(result.sealed).not.toBeNull();
    expect(result.sealed!.evidence.status).toBe('manifest-not-satisfied');
    expect(result.sealed!.evidence.medianHorizontalErrorMeters).toBeNull();
    // How far short it fell is on the record, not only that it did.
    expect(result.sealed!.manifest).toMatchObject({ scoredCount: 2, missingScoredCount: 1 });
    expect((await verifyEvidenceArtifact(result.sealed!)).valid).toBe(true);
  });

  it('lets a missing diagnostic mark pass without comment', async () => {
    // A diagnostic mark never counted toward anything, so failing to reach one
    // is not a shortfall in the figure.
    const result = await sealEvidenceArtifact(
      walk(),
      manifest({
        checkpoints: [
          { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
          { id: 'skipped', position: [9, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
        ],
      }),
    );

    expect(result.sealed).not.toBeNull();
    expect(result.sealed!.evidence.status).toBe('ok');
    expect(result.sealed!.manifest.missingScoredCount).toBe(0);
  });

  it('refuses a mark surveyed somewhere other than where it was declared', async () => {
    // The predeclared position is the ground truth. A walk that records a
    // different one is measuring against something chosen after the fact.
    expect(await refusalsFor(walk({ markPosition: [4.5, 9] }), manifest())).toContain(
      'checkpoint-claim-mismatch',
    );
  });

  it('refuses a manifest written for another venue', async () => {
    expect(await refusalsFor(walk(), manifest({ packageHash: 'c'.repeat(64) }))).toContain(
      'manifest-venue-mismatch',
    );
    expect(await refusalsFor(walk(), manifest({ buildingId: 'elsewhere' }))).toContain(
      'manifest-venue-mismatch',
    );
  });

  it('refuses a malformed manifest', async () => {
    expect(
      await refusalsFor(
        walk(),
        manifest({ manifestVersion: '0.0.1' as typeof CHECKPOINT_MANIFEST_VERSION }),
      ),
    ).toContain('manifest-invalid');

    expect(
      await refusalsFor(
        walk(),
        manifest({
          checkpoints: [
            { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
            { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
          ],
        }),
      ),
    ).toContain('manifest-invalid');
  });

  it('refuses a capture that does not validate', async () => {
    const session = walk();
    session.events = session.events.filter((event) => event.type !== 'lifecycle');

    expect(await refusalsFor(session, manifest())).toContain('capture-invalid');
  });
});

describe('the artifact surface stays narrow', () => {
  it('does not expose evidence policy internals through the package root', () => {
    const exported = Object.keys(pkg);

    for (const name of [
      'publishableSurveyMethods',
      'maxPublishableSurveyAccuracyMeters',
      'evidentialSensorModel',
      'EVIDENCE_POLICY_VERSION',
      'canonicalJson',
    ]) {
      expect(exported).not.toContain(name);
    }
  });
});

describe('the manifest is authoritative over the denominator', () => {
  it('never counts a mark the manifest declared diagnostic', async () => {
    // The role used to be decorative: a mark declared diagnostic still sealed
    // as ok with the same median and a checkpointCount of 1, while the manifest
    // beside it reported scoredCount 0.
    const sealed = await seal(
      walk(),
      manifest({
        checkpoints: [{ id: 'mark', position: [3.5, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true }],
      }),
    );

    expect(sealed.manifest.scoredCount).toBe(0);
    expect(sealed.evidence.checkpointCount).toBe(0);
    expect(sealed.evidence.medianHorizontalErrorMeters).toBeNull();
    expect(sealed.evidence.status).not.toBe('ok');
    // The mark is still recorded, with the reason it did not count.
    expect(sealed.evidence.eligibility.exclusionCounts['not-declared-scored']).toBe(1);
  });

  it('refuses ok when a predeclared scored mark did not survive eligibility', async () => {
    const recorder = new SessionRecorder({
      sessionId: 'sealed-walk',
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      device,
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });
    recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
      recorder.recordImu({
        timeMs,
        accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
        gyroscope: [0, 0, 0],
      });
    }
    // Predeclared as scored, but its survey method is outside policy.
    recorder.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'estimated',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    recorder.recordLifecycle('session-end', 3_100);

    // The manifest promised `estimated` too, so the capture and the manifest
    // agree; what fails is policy, which no amount of agreement can rescue.
    const sealed = await seal(
      recorder.buildSession(),
      manifest({
        checkpoints: [
          { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'estimated', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
        ],
      }),
    );

    // A walk that covered less of the manifest than promised cannot report
    // against the promise, even though nothing else about it looks wrong.
    expect(sealed.evidence.status).toBe('manifest-not-satisfied');
    expect(sealed.evidence.medianHorizontalErrorMeters).toBeNull();
  });

  it('refuses a capture that reuses one checkpoint id', async () => {
    // Comparison against the manifest is by id, so two marks sharing one
    // collapsed to a single entry there while evaluation scored both: one
    // predeclaration produced two published checkpoint errors.
    const recorder = new SessionRecorder({
      sessionId: 'sealed-walk',
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      device,
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });
    recorder.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
      recorder.recordImu({
        timeMs,
        accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
        gyroscope: [0, 0, 0],
      });
    }
    for (let copy = 0; copy < 2; copy += 1) {
      recorder.recordGroundTruth({
        timeMs: 3_000,
        checkpointId: 'mark',
        position: [3.5, 9],
        floorId: 'g',
        surveyMethod: 'tape-measure',
        expectedAccuracyMeters: 0.03,
        independentOfAnchors: true,
      });
    }
    recorder.recordLifecycle('session-end', 3_100);
    const session = recorder.buildSession();

    // Enforced at sealing, not in capture validation: the capture stream is at
    // 0.2.0 and adding a rule to it would change a released contract without
    // the version saying so.
    expect(validateCaptureSession(session)).toEqual([]);
    const result = await sealEvidenceArtifact(session, manifest());
    expect(result.sealed).toBeNull();
    expect(result.refusals.map((refusal) => refusal.reason)).toContain('duplicate-checkpoint-id');
  });
});

describe('validation runs before any hash is trusted', () => {
  it('refuses a self-consistent object that is not an artifact', async () => {
    // A digest says the bytes agree with themselves, not that they describe an
    // evidence artifact. An object carrying only a version and a matching hash
    // verified, and so did one with undeclared fields added and rehashed.
    const bytes = new TextEncoder().encode(
      `${JSON.stringify({ artifactVersion: EVIDENCE_ARTIFACT_VERSION }, null, 2)}\n`,
    );
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const contentHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const minimal = { artifactVersion: EVIDENCE_ARTIFACT_VERSION, contentHash };

    expect((await verifyEvidenceArtifact(minimal)).valid).toBe(false);
    expect((await importEvidenceArtifact(JSON.stringify(minimal))).valid).toBe(false);
  });

  it('refuses an artifact carrying fields the schema does not define', async () => {
    const sealed = await seal();
    const widened = { ...structuredClone(sealed), smuggled: 'extra' } as unknown;

    const verification = await verifyEvidenceArtifact(widened);
    expect(verification.valid).toBe(false);
    expect(verification.valid === false && verification.issues.join(' ')).toMatch(/smuggled/);
  });

  it('refuses a non-finite metric that JSON would write as null', async () => {
    // JSON has no NaN or infinity: all three serialise as null. A metric
    // switched from null to NaN in memory therefore hashed identically and
    // verified against the unchanged seal, handing a reader NaN.
    const unsupported = new SessionRecorder({
      sessionId: 'sealed-walk',
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      device: { ...device, sensors: { ...device.sensors, frame: 'device' } },
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });
    unsupported.recordScan({ timeMs: 100, transport: 'qr', payload: 'vg:corridor-start' });
    unsupported.recordImu({ timeMs: 100, accelerometer: [0, 0, 9.81], gyroscope: [0, 0, 0] });
    unsupported.recordGroundTruth({
      timeMs: 200,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    unsupported.recordLifecycle('session-end', 300);

    const sealed = await seal(unsupported.buildSession());
    expect(sealed.evidence.medianHorizontalErrorMeters).toBeNull();

    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const forged = structuredClone(sealed) as EvidenceArtifact;
      forged.evidence.medianHorizontalErrorMeters = poison;
      // The canonical bytes are unchanged, so only shape checking can catch it.
      expect((await verifyEvidenceArtifact(forged)).valid, String(poison)).toBe(false);
    }
  });

  it('refuses a status and its metrics disagreeing', async () => {
    // Asked of the decoder, not of the digest: both mutations change the bytes,
    // so verifying would report success without the shape being judged at all.
    const sealed = await seal();

    const withheld = structuredClone(sealed) as EvidenceArtifact;
    withheld.evidence.medianHorizontalErrorMeters = null;
    expect(decodeEvidenceArtifact(withheld).artifact).toBeNull();

    const claimed = structuredClone(sealed) as EvidenceArtifact;
    claimed.evidence.status = 'interrupted-capture';
    expect(decodeEvidenceArtifact(claimed).artifact).toBeNull();
  });

  it('never throws on a malformed manifest, whatever it is', async () => {
    const hostile: unknown[] = [
      null,
      undefined,
      42,
      'manifest',
      [],
      {},
      { manifestVersion: CHECKPOINT_MANIFEST_VERSION },
      { ...manifest(), checkpoints: 'not-a-list' },
      { ...manifest(), checkpoints: [{ id: 'mark' }] },
      { ...manifest(), checkpoints: [{ id: 'mark', position: [1], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true }] },
      {
        ...manifest(),
        checkpoints: [{ id: 'm', position: [Number.NaN, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true }],
      },
      { ...manifest(), smuggled: true },
    ];

    for (const value of hostile) {
      const result = await sealEvidenceArtifact(walk(), value);
      expect(result.sealed, String(value)).toBeNull();
      expect(result.refusals.map((refusal) => refusal.reason)).toContain('manifest-invalid');
    }
  });

  it('refuses to export something that would not verify', async () => {
    const sealed = await seal();
    const broken = structuredClone(sealed) as EvidenceArtifact;
    broken.evidence.observationCount = Number.NaN;

    await expect(exportEvidenceArtifact(broken)).rejects.toThrow(/would not verify/);
  });
});

describe('inputs are read once, before anything is awaited', () => {
  it('ignores a capture mutated while sealing awaits a digest', async () => {
    const session = walk();
    const pending = sealEvidenceArtifact(session, manifest());

    // Sealing yields at its first await. Rewriting the session here used to
    // produce an artifact that verified perfectly while describing two
    // different walks: old hashes and evidence, new metadata.
    (session as { sessionId: string }).sessionId = 'rewritten-mid-seal';

    const result = await pending;
    expect(result.sealed).not.toBeNull();
    expect(result.sealed!.capture.sessionId).toBe('sealed-walk');
    expect((await verifyEvidenceArtifact(result.sealed!)).valid).toBe(true);
  });

  it('ignores a manifest mutated while sealing awaits a digest', async () => {
    const declared = manifest();
    const pending = sealEvidenceArtifact(walk(), declared);

    declared.checkpoints[0].role = 'diagnostic';
    declared.buildingId = 'elsewhere';

    const result = await pending;
    expect(result.sealed).not.toBeNull();
    expect(result.sealed!.manifest.scoredCount).toBe(1);
    expect(result.sealed!.evidence.status).toBe('ok');
  });
});

describe('every tuning that moves a figure is fingerprinted', () => {
  it('records the localization filter tuning alongside the rest', async () => {
    const sealed = await seal();

    // The filter took its configuration from a shared mutable default that no
    // resolver guarded and no fingerprint recorded, so the same capture could
    // produce a different figure while the artifact recorded identical
    // configuration.
    expect(sealed.configuration.filter).toMatchObject({
      accelerationNoiseMetersPerSecond2: 0.45,
      headingDriftDegreesPerSecond: 2,
      highQualitySigmaMeters: 1,
      degradedQualitySigmaMeters: 3,
      highQualityCorrectionAgeMs: 5_000,
      degradedQualityCorrectionAgeMs: 15_000,
    });
  });

  it('keeps every configuration authority beyond reach', () => {
    for (const authority of [
      DEFAULT_LOCALIZATION_FILTER_CONFIG,
      DEFAULT_CHECKPOINT_CONFIG,
      DEFAULT_DEAD_RECKONING_CONFIG,
    ]) {
      expect(Object.isFrozen(authority)).toBe(true);
    }

    // Two filters must not share one configuration object.
    const first = new LocalizationFilter() as unknown as { config: Record<string, number> };
    const second = new LocalizationFilter() as unknown as { config: Record<string, number> };
    expect(first.config).not.toBe(second.config);
    first.config.accelerationNoiseMetersPerSecond2 = 99;
    expect(second.config.accelerationNoiseMetersPerSecond2).toBe(0.45);
    expect(DEFAULT_LOCALIZATION_FILTER_CONFIG.accelerationNoiseMetersPerSecond2).toBe(0.45);
  });
});

describe('decoding is deep, descriptor-safe, and produces the value returned', () => {
  /**
   * Puts a mutation to the decoder directly.
   *
   * Asking `verifyEvidenceArtifact` instead would pass on a digest mismatch
   * alone: every mutation changes the bytes, so the test would report success
   * without the decoder ever having an opinion. What is under test here is
   * whether the shape is rejected, so the shape is what gets asked.
   */
  const rewritten = async (mutate: (artifact: EvidenceArtifact) => void) => {
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    mutate(forged);
    const decoding = decodeEvidenceArtifact(forged);
    return { valid: decoding.artifact !== null, issues: decoding.issues };
  };

  it('refuses junk below a section header', async () => {
    // Validation stopped at section headers, so each of these verified once the
    // artifact was rehashed around them.
    // Reaching into a sealed shape to break it deliberately: the artifact type
    // does not admit these fields, which is the point of writing them.
    const loose = (value: unknown) => value as Record<string, unknown>;
    const cases: Array<[string, (artifact: EvidenceArtifact) => void]> = [
      ['an undeclared field inside sampling', (a) => { loose(a.evidence.sampling).rawEvents = [{ secret: 1 }]; }],
      ['an undeclared field inside eligibility', (a) => { loose(a.evidence.eligibility).smuggled = 'x'; }],
      ['a fractional count', (a) => { loose(a.evidence).checkpointCount = 1.5; }],
      ['a count that is not a number', (a) => { loose(a.evidence).observationCount = '12'; }],
      ['a configuration block missing a value', (a) => { delete loose(a.configuration.deadReckoning).strideLengthMeters; }],
      ['a named property on a policy array', (a) => { loose(a.policy.publishableSurveyMethods).smuggled = 'x'; }],
      ['a survey method the schema does not define', (a) => { loose(a.evidence.survey.methods).guessed = 1; }],
      ['a malformed sampling gap', (a) => { loose(a.evidence.sampling).gaps = [[1]]; }],
      ['an exclusion reason that does not exist', (a) => { loose(a.evidence.eligibility.exclusionCounts).invented = 0; }],
    ];

    for (const [name, mutate] of cases) {
      expect((await rewritten(mutate)).valid, name).toBe(false);
    }
  });

  it('refuses a status outside the set the processor can produce', async () => {
    const verification = await rewritten((artifact) => {
      (artifact.evidence as { status: string }).status = 'made-up-status';
      // Nulled so the status/metric invariant is not what catches it.
      artifact.evidence.medianHorizontalErrorMeters = null;
      artifact.evidence.p95HorizontalErrorMeters = null;
      artifact.evidence.floorAccuracy = null;
    });

    expect(verification.valid).toBe(false);
  });

  it('refuses a non-finite value nested anywhere, not only at the top', async () => {
    // JSON writes NaN and both infinities as null, so a nested nullable field
    // switched to NaN hashed identically and verified unchanged.
    for (const path of ['alignment', 'sampling'] as const) {
      const verification = await rewritten((artifact) => {
        if (path === 'alignment') artifact.evidence.alignment.worstAlignmentDeltaMs = Number.NaN;
        else artifact.evidence.sampling.jitterMs = Number.NaN;
      });
      expect(verification.valid, path).toBe(false);
    }
  });

  it('refuses cross-section arithmetic that never happened', async () => {
    expect(
      (await rewritten((artifact) => {
        artifact.evidence.eligibility.surveyed = 9;
      })).valid,
    ).toBe(false);

    expect(
      (await rewritten((artifact) => {
        artifact.evidence.checkpointCount = 5;
      })).valid,
    ).toBe(false);
  });

  it('never invokes a getter while reading an artifact', async () => {
    let reads = 0;
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    Object.defineProperty(forged.capture, 'sessionId', {
      get() {
        reads += 1;
        return 'sealed-walk';
      },
      enumerable: true,
      configurable: true,
    });

    const verification = await verifyEvidenceArtifact(forged);

    // A validator that reads through getters is not a validator: the value it
    // checked and the value a consumer reads need not be the same value.
    expect(reads).toBe(0);
    expect(verification.valid).toBe(false);
  });

  it('returns a snapshot, not the object it was handed', async () => {
    const live = structuredClone(await seal()) as EvidenceArtifact;
    const pending = verifyEvidenceArtifact(live);

    // Verification hashed a shallow view, awaited a digest, and then returned
    // the caller's object, so a mutation landing in that window came back
    // labelled valid.
    (live.evidence as { medianHorizontalErrorMeters: number }).medianHorizontalErrorMeters = 0.001;

    const verification = await pending;
    expect(verification.valid).toBe(true);
    expect(verification.valid && verification.artifact).not.toBe(live);
    expect(verification.valid && verification.artifact.evidence.medianHorizontalErrorMeters)
      .toBeCloseTo(3.688, 3);
  });

  it('refuses to export anything import would reject', async () => {
    // Export checked shape but not the digest, so it wrote files that the very
    // next import rejected. The field rewritten here is deliberately one the
    // decoder accepts, so only the seal can catch it.
    const broken = structuredClone(await seal()) as EvidenceArtifact;
    broken.capture.sessionId = 'a-different-walk';
    expect(decodeEvidenceArtifact(broken).artifact).not.toBeNull();

    await expect(exportEvidenceArtifact(broken)).rejects.toThrow(/would not verify/);
  });

  it('exports only what round-trips', async () => {
    const sealed = await seal();
    const text = await exportEvidenceArtifact(sealed);
    const imported = await importEvidenceArtifact(text);

    expect(imported.valid).toBe(true);
    expect(imported.artifact).toEqual(sealed);
  });
});

describe('tampering cannot be sanitised into a valid artifact', () => {
  it('refuses a prototype-sensitive key rather than swallowing it', async () => {
    // Decoding a map into `{}` discarded `__proto__` silently: the snapshot
    // hashed like the untampered original, verification called it valid, and
    // export wrote the sanitised version. The tampering had to survive to the
    // decoder to be refused, so the map is null-prototype and the key is named.
    const sealed = await seal();
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const forged = structuredClone(sealed) as EvidenceArtifact;
      Object.defineProperty(forged.evidence.survey.methods, key, {
        value: 7,
        enumerable: true,
        configurable: true,
        writable: true,
      });

      const decoding = decodeEvidenceArtifact(forged);
      expect(decoding.artifact, key).toBeNull();
      expect(decoding.issues.join(' ')).toContain(key);
      expect((await verifyEvidenceArtifact(forged)).valid, key).toBe(false);
    }
  });

  it('returns zero rather than negative zero', async () => {
    // `-0` and `0` are the same JSON, so a flipped sign hashed identically and
    // came back out of the decoder still negative.
    const sealed = await seal();
    const forged = structuredClone(sealed) as EvidenceArtifact;
    forged.evidence.sampling.jitterMs = -0;

    const verification = await verifyEvidenceArtifact(forged);
    expect(verification.valid).toBe(true);
    expect(
      verification.valid && Object.is(verification.artifact.evidence.sampling.jitterMs, -0),
    ).toBe(false);
  });

  it('refuses a digest that is not one', async () => {
    for (const field of ['capture', 'manifest'] as const) {
      const forged = structuredClone(await seal()) as EvidenceArtifact;
      forged[field].contentHash = 'x';
      expect(decodeEvidenceArtifact(forged).artifact, field).toBeNull();
    }

    const shouty = structuredClone(await seal()) as EvidenceArtifact;
    shouty.capture.contentHash = shouty.capture.contentHash.toUpperCase();
    expect(decodeEvidenceArtifact(shouty).artifact).toBeNull();
  });

  it('refuses counts that do not add up', async () => {
    const cases: Array<[string, (artifact: EvidenceArtifact) => void]> = [
      ['a scored mark that was never scored', (a) => { a.evidence.checkpointCount = 0; }],
      ['reasons without exclusions', (a) => { a.evidence.eligibility.exclusionCounts['dependent-on-anchor'] = 2; }],
      ['a survey breakdown that misses marks', (a) => { a.evidence.survey.methods['tape-measure'] = 5; }],
    ];

    for (const [name, mutate] of cases) {
      const forged = structuredClone(await seal()) as EvidenceArtifact;
      mutate(forged);
      expect(decodeEvidenceArtifact(forged).artifact, name).toBeNull();
    }
  });

  it('refuses metrics outside the range their meaning allows', async () => {
    const cases: Array<[string, (artifact: EvidenceArtifact) => void]> = [
      ['a negative distance', (a) => { a.evidence.medianHorizontalErrorMeters = -1; }],
      ['a p95 below its median', (a) => { a.evidence.p95HorizontalErrorMeters = 0.1; }],
      ['a proportion above one', (a) => { a.evidence.floorAccuracy = 1.5; }],
      ['a reversed sampling gap', (a) => { a.evidence.sampling.gaps = [[900, 100]]; }],
      ['a negative sampling gap', (a) => { a.evidence.sampling.gaps = [[-5, 100]]; }],
    ];

    for (const [name, mutate] of cases) {
      const forged = structuredClone(await seal()) as EvidenceArtifact;
      mutate(forged);
      expect(decodeEvidenceArtifact(forged).artifact, name).toBeNull();
    }
  });

  it('refuses a policy or threshold this build did not apply', async () => {
    const cases: Array<[string, (artifact: EvidenceArtifact) => void]> = [
      ['a widened method set', (a) => { a.policy.publishableSurveyMethods.push('estimated'); }],
      ['a loosened accuracy bound', (a) => { a.policy.maxPublishableSurveyAccuracyMeters = 5; }],
      ['a different sensor model', (a) => { a.policy.evidentialSensorModel.frame = 'device'; }],
      ['a moved threshold', (a) => { a.configuration.thresholds.materialSensorGapMs = 9_999; }],
      ['a moved tolerance', (a) => { a.evidence.alignment.toleranceMs = 5_000; }],
    ];

    for (const [name, mutate] of cases) {
      const forged = structuredClone(await seal()) as EvidenceArtifact;
      mutate(forged);
      expect(decodeEvidenceArtifact(forged).artifact, name).toBeNull();
    }
  });
});

describe('reading an artifact or a manifest never throws', () => {
  it('fails closed on a Proxy that raises, and on a revoked one', async () => {
    const sealed = await seal();

    const hostile = new Proxy(structuredClone(sealed) as object, {
      getOwnPropertyDescriptor() {
        throw new Error('trap');
      },
      ownKeys() {
        throw new Error('trap');
      },
    });
    expect(() => decodeEvidenceArtifact(hostile)).not.toThrow();
    expect(decodeEvidenceArtifact(hostile).artifact).toBeNull();
    await expect(verifyEvidenceArtifact(hostile)).resolves.toMatchObject({ valid: false });

    const revocable = Proxy.revocable(structuredClone(sealed) as object, {});
    revocable.revoke();
    expect(() => decodeEvidenceArtifact(revocable.proxy)).not.toThrow();
    expect(decodeEvidenceArtifact(revocable.proxy).artifact).toBeNull();
  });

  it('reads a manifest by descriptor, so a getter never runs', async () => {
    let reads = 0;
    const hostile = {
      manifestVersion: CHECKPOINT_MANIFEST_VERSION,
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      checkpoints: [
        {
          id: 'mark',
          floorId: 'g',
          role: 'scored' as const,
          get position(): [number, number] {
            reads += 1;
            // A changing getter validated one position and snapshotted another.
            return reads === 1 ? [3.5, 9] : [400, 400];
          },
        },
      ],
    };

    const result = await sealEvidenceArtifact(walk(), hostile);
    expect(reads).toBe(0);
    expect(result.sealed).toBeNull();
    expect(result.refusals.map((refusal) => refusal.reason)).toContain('manifest-invalid');
  });

  it('fails closed on a manifest whose getter throws', async () => {
    const hostile = {
      manifestVersion: CHECKPOINT_MANIFEST_VERSION,
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      get checkpoints(): unknown {
        throw new Error('no');
      },
    };

    // A throwing getter escaped a function that promises never to throw.
    const result = await sealEvidenceArtifact(walk(), hostile);
    expect(result.sealed).toBeNull();
    expect(result.refusals.map((refusal) => refusal.reason)).toContain('manifest-invalid');
  });
});

describe('the last places a value slipped through unread', () => {
  it('returns zero for a count written as negative zero', async () => {
    // `-0` is a safe integer and is not less than zero, so it passed every
    // check, hashed as `0`, and came back out of the decoder still signed.
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.configuration.routeSegmentCount = -0;

    const verification = await verifyEvidenceArtifact(forged);
    expect(verification.valid).toBe(true);
    expect(
      verification.valid && Object.is(verification.artifact.configuration.routeSegmentCount, -0),
    ).toBe(false);
  });

  it('names a rejected value without coercing it', async () => {
    // Formatting an invalid field with `String(value)` ran the caller's
    // `Symbol.toPrimitive`, so a throwing one escaped the validator that had
    // just refused to trust the value.
    const hostile = {
      manifestVersion: {
        [Symbol.toPrimitive]() {
          throw new Error('no');
        },
      },
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      checkpoints: [],
    };

    const result = await sealEvidenceArtifact(walk(), hostile);
    expect(result.sealed).toBeNull();
    expect(result.refusals.map((refusal) => refusal.reason)).toContain('manifest-invalid');

    const validation = validateCheckpointManifest(hostile);
    expect(validation.manifest).toBeNull();
    expect(validation.issues[0].detail).toContain('an object');
  });

  it('requires a venue package hash to be one', async () => {
    // A capture and manifest both naming the venue "x" sealed and verified.
    const result = await sealEvidenceArtifact(
      walk({ packageHash: 'x' }),
      manifest({ packageHash: 'x' }),
    );
    expect(result.sealed).toBeNull();
    expect(result.refusals.map((refusal) => refusal.reason)).toContain('manifest-invalid');

    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.venue.packageHash = 'x';
    expect(decodeEvidenceArtifact(forged).artifact).toBeNull();
  });

  it('requires survey counts to be counts', async () => {
    // Summing correctly is not enough: a fractional pair that adds up still
    // describes marks nobody surveyed.
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.evidence.survey.methods['tape-measure'] = 1.5;
    forged.evidence.survey.methods['laser-distance'] = -0.5;

    const decoding = decodeEvidenceArtifact(forged);
    expect(decoding.artifact).toBeNull();
    expect(decoding.issues.join(' ')).toContain('whole number of marks');
  });
});

describe('a diagnostic is the last place that may throw', () => {
  it('names a revoked value without raising', async () => {
    // describeValue guarded every coercion and then ended on Array.isArray,
    // which raises on a revoked Proxy — so refusing an invalid manifestVersion
    // threw a raw TypeError out of both validation and sealing.
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    const hostile = {
      manifestVersion: revocable.proxy,
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      checkpoints: [],
    };

    expect(() => validateCheckpointManifest(hostile)).not.toThrow();
    const validation = validateCheckpointManifest(hostile);
    expect(validation.manifest).toBeNull();
    expect(validation.issues[0].detail).toContain('unreadable');

    await expect(sealEvidenceArtifact(walk(), hostile)).resolves.toMatchObject({ sealed: null });
    const result = await sealEvidenceArtifact(walk(), hostile);
    expect(result.refusals.map((refusal) => refusal.reason)).toContain('manifest-invalid');
  });
});

describe('the manifest precommits every claim eligibility reads', () => {
  const entry = (overrides: Partial<CheckpointManifestEntry> = {}): CheckpointManifestEntry => ({
    id: 'mark',
    position: [3.5, 9],
    floorId: 'g',
    role: 'scored',
    surveyMethod: 'tape-measure',
    expectedAccuracyMeters: 0.03,
    independentOfAnchors: true,
    ...overrides,
  });

  it('refuses a capture that upgrades a claim after the walk', async () => {
    // Eligibility reads these from the capture, which is written after the
    // walk. Unpinned, a mark that came out badly could be rescued by claiming a
    // better survey, or dropped by claiming a worse one.
    const upgrades: Array<[string, Partial<CheckpointManifestEntry>]> = [
      ['how it was surveyed', { surveyMethod: 'total-station' }],
      ['how accurate that survey is', { expectedAccuracyMeters: 0.2 }],
      ['whether it is independent of anchors', { independentOfAnchors: false }],
    ];

    for (const [about, difference] of upgrades) {
      const result = await sealEvidenceArtifact(
        walk(),
        manifest({ checkpoints: [entry(difference)] }),
      );
      expect(result.sealed, about).toBeNull();
      expect(result.refusals.map((refusal) => refusal.reason)).toContain(
        'checkpoint-claim-mismatch',
      );
      expect(result.refusals[0].detail).toContain(about);
    }
  });

  it('requires a manifest to predeclare the claims at all', async () => {
    const incomplete = [
      { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored' },
      { ...entry(), surveyMethod: 'guessed' },
      { ...entry(), expectedAccuracyMeters: -1 },
      { ...entry(), independentOfAnchors: 'yes' },
    ];

    for (const checkpoints of incomplete) {
      const validation = validateCheckpointManifest({
        manifestVersion: CHECKPOINT_MANIFEST_VERSION,
        buildingId: 'reference-medical-centre',
        packageHash: PACKAGE_HASH,
        checkpoints: [checkpoints],
      });
      expect(validation.manifest).toBeNull();
    }
  });

  it('changes the manifest hash when any predeclared claim changes', async () => {
    // Each variant is sealed against a capture that matches it, so the seal
    // succeeds and the hash is the only thing under test. Varying only `role`
    // would prove nothing about the claims added here — it was hashed already.
    const baseline = await seal();

    const variants: Array<[string, Partial<CheckpointManifestEntry>, WalkOptions]> = [
      ['the survey method', { surveyMethod: 'laser-distance' }, { surveyMethod: 'laser-distance' }],
      ['the expected accuracy', { expectedAccuracyMeters: 0.05 }, { expectedAccuracyMeters: 0.05 }],
      [
        'independence from anchors',
        { independentOfAnchors: false },
        { independentOfAnchors: false },
      ],
      ['the intended role', { role: 'diagnostic' }, {}],
    ];

    for (const [about, difference, capture] of variants) {
      const result = await sealEvidenceArtifact(
        walk(capture),
        manifest({ checkpoints: [entry(difference)] }),
      );
      expect(result.sealed, about).not.toBeNull();
      expect(result.sealed!.manifest.contentHash, about).not.toBe(baseline.manifest.contentHash);
      expect(result.sealed!.contentHash, about).not.toBe(baseline.contentHash);
    }
  });
});

describe('manifest counts reconcile with the evidence beside them', () => {
  it('refuses a scored count the walk cannot account for', async () => {
    // Raising scoredCount from 1 to 2 and rehashing left an artifact claiming
    // two predeclared marks beside a single surveyed, published checkpoint.
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.manifest.scoredCount = 2;

    const decoding = decodeEvidenceArtifact(forged);
    expect(decoding.artifact).toBeNull();
    expect(decoding.issues.join(' ')).toContain('scoredCount');
  });

  it('refuses ok unless every predeclared scored mark backed the figure', async () => {
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    // Consistent with itself: one mark missing, counts balanced, still ok.
    forged.manifest.scoredCount = 2;
    forged.manifest.missingScoredCount = 1;

    expect(decodeEvidenceArtifact(forged).artifact).toBeNull();
  });

  it('refuses a shortfall claim when nothing fell short', async () => {
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.evidence.status = 'manifest-not-satisfied';
    forged.evidence.medianHorizontalErrorMeters = null;
    forged.evidence.p95HorizontalErrorMeters = null;
    forged.evidence.floorAccuracy = null;

    expect(decodeEvidenceArtifact(forged).artifact).toBeNull();
  });

  it('refuses more diagnostic marks than the manifest declared', async () => {
    const sealed = await seal(
      walk(),
      manifest({
        checkpoints: [
          { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
        ],
      }),
    );
    expect(sealed.evidence.eligibility.exclusionCounts['not-declared-scored']).toBe(1);

    const forged = structuredClone(sealed) as EvidenceArtifact;
    forged.manifest.diagnosticCount = 0;
    expect(decodeEvidenceArtifact(forged).artifact).toBeNull();
  });

  it('accepts the honest counts it was sealed with', async () => {
    // The invariants must not refuse a real artifact, in either shape.
    for (const declared of [
      manifest(),
      manifest({
        checkpoints: [
          { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
        ],
      }),
    ]) {
      const result = await sealEvidenceArtifact(walk(), declared);
      expect(result.sealed).not.toBeNull();
      expect((await verifyEvidenceArtifact(result.sealed!)).valid).toBe(true);
    }
  });
});

describe('a status is a claim about the counts beside it', () => {
  const diagnosticOnly = () =>
    manifest({
      checkpoints: [
        { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
      ],
    });

  const missingScored = () =>
    manifest({
      checkpoints: [
        { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
        { id: 'never-walked', position: [9, 9], floorId: 'g', role: 'scored', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
      ],
    });

  it('refuses ok on a walk that scored nothing', async () => {
    // `publishable === scoredCount` alone is satisfied by `0 === 0`, so a
    // diagnostic-only walk could be relabelled ok, given fabricated metrics and
    // rehashed, and it verified with nothing scored at all.
    const sealed = await seal(walk(), diagnosticOnly());
    expect(sealed.evidence.status).toBe('insufficient-ground-truth');
    expect(sealed.manifest.scoredCount).toBe(0);
    expect(sealed.evidence.checkpointCount).toBe(0);

    const forged = structuredClone(sealed) as EvidenceArtifact;
    forged.evidence.status = 'ok';
    forged.evidence.medianHorizontalErrorMeters = 0.4;
    forged.evidence.p95HorizontalErrorMeters = 0.6;
    forged.evidence.floorAccuracy = 1;

    const decoding = decodeEvidenceArtifact(forged);
    expect(decoding.artifact).toBeNull();
    expect(decoding.issues.join(' ')).toContain('nothing was scored');
  });

  it('refuses insufficient-ground-truth while marks are still counted', async () => {
    // A missing-scored artifact relabelled this way kept a published checkpoint
    // beside a deficit it no longer admitted to.
    const result = await sealEvidenceArtifact(walk(), missingScored());
    const sealed = result.sealed!;
    expect(sealed.evidence.status).toBe('manifest-not-satisfied');

    const forged = structuredClone(sealed) as EvidenceArtifact;
    forged.evidence.status = 'insufficient-ground-truth';

    expect(decodeEvidenceArtifact(forged).artifact).toBeNull();
  });

  it('refuses a manifest-not-satisfied claim with no deficit', async () => {
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.evidence.status = 'manifest-not-satisfied';
    forged.evidence.medianHorizontalErrorMeters = null;
    forged.evidence.p95HorizontalErrorMeters = null;
    forged.evidence.floorAccuracy = null;

    expect(decodeEvidenceArtifact(forged).artifact).toBeNull();
  });

  it('still accepts each status on the walk that genuinely produced it', async () => {
    const cases: Array<[string, CheckpointManifest]> = [
      ['ok', manifest()],
      ['insufficient-ground-truth', diagnosticOnly()],
      ['manifest-not-satisfied', missingScored()],
    ];

    for (const [status, declared] of cases) {
      const result = await sealEvidenceArtifact(walk(), declared);
      expect(result.sealed, status).not.toBeNull();
      expect(result.sealed!.evidence.status, status).toBe(status);
      expect((await verifyEvidenceArtifact(result.sealed!)).valid, status).toBe(true);
    }
  });
});

describe('no status can be worn by a walk that did not earn it', () => {
  it('refuses a scored walk relabelled as never localized', async () => {
    // Without a first fix there is no estimate to score against, so a
    // publishable or published mark cannot coexist with this status.
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.evidence.status = 'insufficient-localization';
    forged.evidence.medianHorizontalErrorMeters = null;
    forged.evidence.p95HorizontalErrorMeters = null;
    forged.evidence.floorAccuracy = null;

    const decoding = decodeEvidenceArtifact(forged);
    expect(decoding.artifact).toBeNull();
    expect(decoding.issues.join(' ')).toContain('insufficient-localization');
  });

  it('refuses a status sealing cannot produce', async () => {
    // `unofficial-recording` is what replayRecording reports for a bare
    // recording. An artifact can never legitimately carry it, but the decoder
    // accepted every status the type admits rather than every status this path
    // emits.
    const forged = structuredClone(await seal()) as EvidenceArtifact;
    forged.evidence.status = 'unofficial-recording';
    forged.evidence.medianHorizontalErrorMeters = null;
    forged.evidence.p95HorizontalErrorMeters = null;
    forged.evidence.floorAccuracy = null;

    expect(decodeEvidenceArtifact(forged).artifact).toBeNull();
  });

  it('refuses every status a scored walk did not produce', async () => {
    // Swept rather than sampled. The gap here was never one status: each fix
    // constrained the one under review and left the rest free to carry any
    // counts at all.
    const sealed = await seal();
    expect(sealed.evidence.status).toBe('ok');

    const cannotCarryScoredMarks = [
      'insufficient-localization',
      'insufficient-ground-truth',
      'unofficial-recording',
    ] as const;

    for (const status of cannotCarryScoredMarks) {
      const forged = structuredClone(sealed) as EvidenceArtifact;
      forged.evidence.status = status;
      forged.evidence.medianHorizontalErrorMeters = null;
      forged.evidence.p95HorizontalErrorMeters = null;
      forged.evidence.floorAccuracy = null;

      expect(decodeEvidenceArtifact(forged).artifact, status).toBeNull();
    }
  });

  it('still accepts the blocking statuses that may carry eligible marks', async () => {
    // A walk can be interrupted, or use a sensor model this build cannot read,
    // and still have surveyed a perfectly eligible mark. Those statuses are
    // bound only by the reconciliations every artifact obeys, and refusing them
    // would suppress exactly the outcomes worth recording.
    const interrupted = completeWalkWith((recorder) => {
      recorder.recordLifecycle('backgrounded', 2_000, 'screen locked');
    });

    const result = await sealEvidenceArtifact(interrupted, manifest());
    expect(result.sealed).not.toBeNull();
    expect(result.sealed!.evidence.status).toBe('interrupted-capture');
    expect(result.sealed!.evidence.eligibility.publishable).toBeGreaterThan(0);
    expect((await verifyEvidenceArtifact(result.sealed!)).valid).toBe(true);
  });
});

describe('a status is also a claim about whether the walk localized', () => {
  /** A walk with no resolvable scan: nothing ever obtains a first fix. */
  function neverLocalized(): CaptureSession {
    const recorder = new SessionRecorder({
      sessionId: 'sealed-walk',
      buildingId: 'reference-medical-centre',
      packageHash: PACKAGE_HASH,
      device,
      anchors,
      startedAtIso: '2026-08-07T09:00:00.000Z',
    });
    for (let timeMs = 100; timeMs <= 3_000; timeMs += 20) {
      recorder.recordImu({
        timeMs,
        accelerometer: [0, 0, 9.81 + 3 * Math.sin((2 * Math.PI * timeMs) / 500)],
        gyroscope: [0, 0, 0],
      });
    }
    recorder.recordGroundTruth({
      timeMs: 3_000,
      checkpointId: 'mark',
      position: [3.5, 9],
      floorId: 'g',
      surveyMethod: 'tape-measure',
      expectedAccuracyMeters: 0.03,
      independentOfAnchors: true,
    });
    recorder.recordLifecycle('session-end', 3_100);
    return recorder.buildSession();
  }

  const diagnosticOnlyManifest = () =>
    manifest({
      checkpoints: [
        { id: 'mark', position: [3.5, 9], floorId: 'g', role: 'diagnostic', surveyMethod: 'tape-measure', expectedAccuracyMeters: 0.03, independentOfAnchors: true },
      ],
    });

  const shapes = async () => ({
    scored: await seal(),
    diagnosticOnly: await seal(walk(), diagnosticOnlyManifest()),
    noFix: (await sealEvidenceArtifact(neverLocalized(), manifest())).sealed!,
  });

  it('seals each shape with the status it earned', async () => {
    const { scored, diagnosticOnly, noFix } = await shapes();

    expect(scored.evidence.status).toBe('ok');
    expect(diagnosticOnly.evidence.status).toBe('insufficient-ground-truth');
    expect(noFix.evidence.status).toBe('insufficient-localization');

    // The two zero-scoring shapes are indistinguishable by counts alone, which
    // is precisely why a status table written in terms of scoring let one be
    // worn by the other.
    expect(diagnosticOnly.evidence.eligibility.publishable).toBe(0);
    expect(noFix.evidence.eligibility.publishable).toBe(0);
    expect(diagnosticOnly.evidence.observationCount).toBeGreaterThan(0);
    expect(noFix.evidence.observationCount).toBe(0);
    expect(diagnosticOnly.configuration.filter).not.toBeNull();
    expect(noFix.configuration.filter).toBeNull();
  });

  it('refuses a localized walk relabelled as never localized', async () => {
    const { scored, diagnosticOnly } = await shapes();

    for (const [name, sealed] of [
      ['scored', scored],
      ['diagnostic-only', diagnosticOnly],
    ] as const) {
      const forged = structuredClone(sealed) as EvidenceArtifact;
      forged.evidence.status = 'insufficient-localization';
      forged.evidence.medianHorizontalErrorMeters = null;
      forged.evidence.p95HorizontalErrorMeters = null;
      forged.evidence.floorAccuracy = null;

      const decoding = decodeEvidenceArtifact(forged);
      expect(decoding.artifact, name).toBeNull();
      expect(decoding.issues.join(' ')).toContain('nothing was localized');
    }
  });

  it('refuses a no-fix walk relabelled as anything that follows a fix', async () => {
    const { noFix } = await shapes();

    for (const status of [
      'insufficient-ground-truth',
      'interrupted-capture',
      'invalid-localization-state',
      'manifest-not-satisfied',
      'ok',
    ] as const) {
      const forged = structuredClone(noFix) as EvidenceArtifact;
      forged.evidence.status = status;
      expect(decodeEvidenceArtifact(forged).artifact, status).toBeNull();
    }
  });

  it('refuses observations and filter tuning that disagree', async () => {
    const { scored, noFix } = await shapes();

    const withoutFilter = structuredClone(scored) as EvidenceArtifact;
    withoutFilter.configuration.filter = null;
    expect(decodeEvidenceArtifact(withoutFilter).artifact).toBeNull();

    const withFilter = structuredClone(noFix) as EvidenceArtifact;
    withFilter.configuration.filter = structuredClone(scored.configuration.filter);
    expect(decodeEvidenceArtifact(withFilter).artifact).toBeNull();
  });

  it('lets the two statuses that precede localization carry either shape', async () => {
    // `unsupported-sensor-model` and `incomplete-capture` are decided before
    // localization is, so a walk carrying them may or may not have got a fix.
    // Constraining them would refuse honest artifacts of one shape.
    const { scored, noFix } = await shapes();

    for (const status of ['unsupported-sensor-model', 'incomplete-capture'] as const) {
      for (const [name, sealed] of [
        ['localized', scored],
        ['no-fix', noFix],
      ] as const) {
        const forged = structuredClone(sealed) as EvidenceArtifact;
        forged.evidence.status = status;
        forged.evidence.medianHorizontalErrorMeters = null;
        forged.evidence.p95HorizontalErrorMeters = null;
        forged.evidence.floorAccuracy = null;
        expect(decodeEvidenceArtifact(forged).artifact, `${status}/${name}`).not.toBeNull();
      }
    }
  });
});
