import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeOutcome, parseEvidenceArguments, runEvidenceCli } from './evidenceCli';
import type { EvidenceCliOptions } from './evidenceCli';
import {
  CHECKPOINT_MANIFEST_VERSION,
  SessionRecorder,
  exportCaptureSession,
  type CaptureDeviceProfile,
  type CaptureSession,
  type CheckpointAnchor,
  type CheckpointManifest,
} from './index';

/**
 * Sealing was library-only, which meant the only way to obtain an artifact was
 * to write a program. A figure nobody can produce or check without writing code
 * is not much better than a figure nobody can reproduce at all.
 *
 * What these cover is the boundary, not the sealing rules — those are
 * `evidenceArtifact.test.ts`. The two things a command-line boundary can get
 * wrong that a library cannot are what it writes to disk and which outcomes it
 * calls failures.
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

function walk(sessionId = 'sealed-walk'): CaptureSession {
  const recorder = new SessionRecorder({
    sessionId,
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
    checkpoints: [
      {
        id: 'mark',
        position: [3.5, 9],
        floorId: 'g',
        role: 'scored',
        surveyMethod: 'tape-measure',
        expectedAccuracyMeters: 0.03,
        independentOfAnchors: true,
      },
    ],
    ...overrides,
  };
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'voicegis-evidence-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function paths() {
  return {
    capturePath: join(directory, 'capture.json'),
    manifestPath: join(directory, 'manifest.json'),
    artifactPath: join(directory, 'artifact.json'),
  };
}

async function writeCapture(session: CaptureSession) {
  await writeFile(paths().capturePath, exportCaptureSession(session), 'utf8');
}

async function writeManifest(declared: unknown) {
  await writeFile(paths().manifestPath, `${JSON.stringify(declared, null, 2)}\n`, 'utf8');
}

async function writeInputs(session: CaptureSession = walk(), declared: unknown = manifest()) {
  await writeCapture(session);
  await writeManifest(declared);
}

function sealOptions(check = false): EvidenceCliOptions {
  return { command: 'seal', ...paths(), check };
}

function verifyOptions(): EvidenceCliOptions {
  return { command: 'verify', artifactPath: paths().artifactPath };
}

async function failureFrom(options: EvidenceCliOptions) {
  try {
    await runEvidenceCli(options);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the command to fail, and it succeeded');
}

describe('sealing from the command line', () => {
  it('writes an artifact that verify then accepts', async () => {
    await writeInputs();

    const sealed = await runEvidenceCli(sealOptions());
    expect(sealed.action).toBe('sealed');
    expect(sealed.artifact.evidence.status).toBe('ok');

    const verified = await runEvidenceCli(verifyOptions());
    expect(verified.action).toBe('verified');
    expect(verified.artifact.contentHash).toBe(sealed.artifact.contentHash);
  });

  it('writes the same bytes on every run', async () => {
    await writeInputs();

    await runEvidenceCli(sealOptions());
    const first = await readFile(paths().artifactPath, 'utf8');
    await runEvidenceCli(sealOptions());

    expect(await readFile(paths().artifactPath, 'utf8')).toBe(first);
    // The file is what the library would export, newline included, so an
    // artifact can be diffed and committed like any other generated document.
    expect(first.endsWith('}\n')).toBe(true);
  });

  it('reports the seal without republishing the walk', async () => {
    await writeInputs();
    await runEvidenceCli(sealOptions());

    const written = await readFile(paths().artifactPath, 'utf8');
    expect(written).not.toContain('vg:corridor-start');
    expect(written).not.toContain('"accelerometer"');
  });
});

describe('--check asks whether the inputs still produce the artifact', () => {
  it('passes when they do', async () => {
    await writeInputs();
    await runEvidenceCli(sealOptions());

    const checked = await runEvidenceCli(sealOptions(true));
    expect(checked.action).toBe('reproduced');
  });

  it('leaves a disagreeing artifact on disk rather than repairing it', async () => {
    // A --check that quietly rewrote the file would report success forever and
    // gate nothing. The stale artifact has to survive the check so the
    // disagreement is still there to look at.
    await writeInputs();
    await runEvidenceCli(sealOptions());
    const stale = await readFile(paths().artifactPath, 'utf8');
    await writeCapture(walk('a-different-walk'));

    await failureFrom(sealOptions(true));

    expect(await readFile(paths().artifactPath, 'utf8')).toBe(stale);
  });

  it('fails when an input has changed since the artifact was sealed', async () => {
    await writeInputs();
    await runEvidenceCli(sealOptions());

    // A different walk against the same manifest: the capture hash moves, so
    // the seal does too. This is the case the gate exists to catch — an
    // artifact left behind by inputs that have since been edited.
    await writeCapture(walk('a-different-walk'));

    expect(await failureFrom(sealOptions(true))).toContain('is not what these inputs produce now');
  });

  it('says what to run when nothing has been sealed yet', async () => {
    await writeInputs();

    const message = await failureFrom(sealOptions(true));
    expect(message).toContain('No sealed artifact');
    expect(message).toContain('Run without --check');
  });
});

describe('verifying an artifact on its own', () => {
  it('rejects one whose contents were edited after sealing', async () => {
    await writeInputs();
    await runEvidenceCli(sealOptions());

    const document = JSON.parse(await readFile(paths().artifactPath, 'utf8')) as {
      capture: { sessionId: string };
    };
    document.capture.sessionId = 'a-more-flattering-name';
    await writeFile(paths().artifactPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    expect(await failureFrom(verifyOptions())).toContain('content hash');
  });

  it('rejects a file that is not an artifact at all', async () => {
    await writeFile(paths().artifactPath, '{"nearly": true}\n', 'utf8');

    expect(await failureFrom(verifyOptions())).toContain('did not verify');
  });

  it('names the file it could not read', async () => {
    expect(await failureFrom(verifyOptions())).toContain(paths().artifactPath);
  });
});

describe('what the tool treats as failure', () => {
  it('seals a walk that fell short of its manifest rather than refusing it', async () => {
    // The suppression this guards against is quiet: if a short walk failed the
    // command, running under a gate would mean only the walks that went well
    // ever produced a committed artifact.
    await writeInputs(
      walk(),
      manifest({
        checkpoints: [
          ...manifest().checkpoints,
          {
            id: 'mark-never-reached',
            position: [9, 9],
            floorId: 'g',
            role: 'scored',
            surveyMethod: 'tape-measure',
            expectedAccuracyMeters: 0.03,
            independentOfAnchors: true,
          },
        ],
      }),
    );

    const outcome = await runEvidenceCli(sealOptions());

    expect(outcome.action).toBe('sealed');
    expect(outcome.artifact.evidence.status).toBe('manifest-not-satisfied');
    expect(outcome.artifact.manifest.missingScoredCount).toBe(1);
    expect(describeOutcome(outcome)).toContain('not a failure of this tool');
    expect(describeOutcome(outcome)).toContain('1 of 2 predeclared scored checkpoint(s)');
  });

  it('says nothing extra when the walk produced a figure', async () => {
    await writeInputs();

    const described = describeOutcome(await runEvidenceCli(sealOptions()));

    expect(described.split('\n')).toHaveLength(1);
    expect(described).toContain('status=ok');
  });

  it('refuses a manifest written for another venue, naming the reason', async () => {
    await writeInputs(walk(), manifest({ packageHash: 'c'.repeat(64) }));

    const message = await failureFrom(sealOptions());
    expect(message).toContain('Refusing to seal');
    expect(message).toContain('manifest-venue-mismatch');
  });

  it('lists every capture issue rather than one summary refusal', async () => {
    await writeFile(paths().capturePath, '{"captureVersion": "0.2.0"}\n', 'utf8');
    await writeManifest(manifest());

    const message = await failureFrom(sealOptions());
    expect(message).toContain('is not a valid capture session');
    expect(message).toContain('@/');
  });

  it('reports a manifest that is not JSON as a manifest problem', async () => {
    await writeCapture(walk());
    await writeFile(paths().manifestPath, 'checkpoints: []\n', 'utf8');

    expect(await failureFrom(sealOptions())).toContain('is not valid JSON');
  });
});

describe('argument parsing', () => {
  it('resolves seal paths and reads --check anywhere in the line', () => {
    const options = parseEvidenceArguments(['seal', 'a.json', '--check', 'b.json', 'c.json']);

    expect(options.command).toBe('seal');
    expect(options).toMatchObject({ check: true });
    // Resolved, so the tool does not depend on the caller's working directory
    // being the one the paths were written against.
    if (options.command !== 'seal') throw new Error('expected seal');
    expect(options.capturePath).not.toBe('a.json');
    expect(options.capturePath.endsWith('a.json')).toBe(true);
  });

  it('refuses verify --check instead of ignoring it', () => {
    // It reads as the stronger claim and would silently deliver the weaker one.
    expect(() => parseEvidenceArguments(['verify', 'artifact.json', '--check'])).toThrow(
      /seal --check/,
    );
  });

  it('rejects a command line with the wrong number of paths', () => {
    expect(() => parseEvidenceArguments(['seal', 'a.json'])).toThrow(/Usage/);
    expect(() => parseEvidenceArguments(['verify'])).toThrow(/Usage/);
    expect(() => parseEvidenceArguments(['verify', 'a.json', 'b.json'])).toThrow(/Usage/);
    expect(() => parseEvidenceArguments([])).toThrow(/Usage/);
    expect(() => parseEvidenceArguments(['report', 'a.json'])).toThrow(/Usage/);
  });
});
