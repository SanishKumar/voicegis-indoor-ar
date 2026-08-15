import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importCaptureSession } from './captureStream';
import { buildEvidenceReport } from './recorder';
import { replayRecording } from './replay';
import type { LocalizationRecording } from './types';

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Produces a diagnostic report from whichever input was given.
 *
 * Nothing this tool writes is evidence. A capture session is validated,
 * derived, and put through checkpoint eligibility, which is more than a bare
 * recording gets — a recording carries no survey provenance or independence
 * claims, so it is replayed for diagnosis only and its accuracy figures are
 * withheld. But neither path is sealed, and an unsealed figure names none of
 * the inputs that produced it: no capture hash, no venue package hash, no
 * predeclared checkpoint manifest, no configuration fingerprint.
 *
 * A quotable figure comes from `sealEvidenceArtifact(session, manifest)`, which
 * requires a manifest this tool has no way to supply. Calling this path
 * evidential, as an earlier comment did, described the ambition rather than the
 * output.
 */
function buildReport(parsed: unknown) {
  const imported = importCaptureSession(JSON.stringify(parsed));
  if (imported.session) {
    return { kind: 'session' as const, report: buildEvidenceReport(imported.session).report };
  }

  const recording = parsed as LocalizationRecording;
  if (!recording || typeof recording !== 'object' || !Array.isArray(recording.observations)) {
    throw new Error(
      `Input is neither a valid capture session nor a localization recording: ${imported.issues
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(', ')}`,
    );
  }
  // replayRecording is permanently diagnostic: it already withholds aggregate
  // and per-checkpoint accuracy, so nothing further needs stripping here.
  const { report } = replayRecording(recording);
  return { kind: 'recording' as const, report };
}

async function main() {
  const [inputArgument, outputArgument, checkArgument] = process.argv.slice(2);
  if (!inputArgument || !outputArgument) {
    throw new Error(
      'Usage: localization-replay <capture-or-recording.json> <report.json> [--check]. ' +
        'Produces a diagnostic report. Sealed evidence comes from sealEvidenceArtifact, ' +
        'which needs a predeclared checkpoint manifest this tool does not take.',
    );
  }
  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);
  const parsed = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const { kind, report } = buildReport(parsed);
  const reportText = stableJson(report);

  if (checkArgument === '--check') {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== reportText) throw new Error(`Replay report is stale: ${outputPath}.`);
    process.stdout.write(`verified replay ${report.sessionId} (${kind})\n`);
    return;
  }

  await writeFile(outputPath, reportText, 'utf8');
  process.stdout.write(`replayed ${report.sessionId} (${kind})\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
