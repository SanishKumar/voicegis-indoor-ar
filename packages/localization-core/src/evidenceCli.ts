import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importCaptureSession } from './captureStream';
import {
  exportEvidenceArtifact,
  importEvidenceArtifact,
  sealEvidenceArtifact,
  type EvidenceArtifact,
} from './evidenceArtifact';

/**
 * The evidence tool, deliberately not the same binary as the replay tool.
 *
 * `cli.ts` is diagnostic: it takes one input, writes an unsealed report, and
 * names none of the inputs that produced it. This one cannot produce a figure
 * without a predeclared manifest, and everything it writes carries a seal.
 * Folding both into one command behind a flag would put those two outputs one
 * typo apart, and the entire premise of the artifact is that the difference
 * between a diagnostic and evidence is never a matter of how carefully someone
 * typed.
 *
 * Two different claims are available here and they are not interchangeable:
 *
 * - `verify` reads an artifact alone and recomputes its seal. It says the
 *   document is internally consistent and was sealed by this pipeline. It says
 *   nothing about whether the inputs still produce it.
 * - `seal --check` re-derives the artifact from the capture and manifest and
 *   compares bytes. It says the figure is still reproducible from named inputs
 *   with today's code, which is the claim that decays as the processor changes.
 *
 * Neither says who sealed it. That needs a signature and is outside v0.1.
 */

const USAGE = [
  'Usage:',
  '  evidence seal <capture.json> <manifest.json> <artifact.json> [--check]',
  '  evidence verify <artifact.json>',
].join('\n');

export type EvidenceCliOptions =
  | {
      command: 'seal';
      capturePath: string;
      manifestPath: string;
      artifactPath: string;
      check: boolean;
    }
  | { command: 'verify'; artifactPath: string };

export function parseEvidenceArguments(args: string[]): EvidenceCliOptions {
  const check = args.includes('--check');
  const positional = args.filter((argument) => argument !== '--check');
  const [command, ...rest] = positional;

  if (command === 'seal') {
    if (rest.length !== 3) throw new Error(USAGE);
    return {
      command: 'seal',
      capturePath: resolve(rest[0]),
      manifestPath: resolve(rest[1]),
      artifactPath: resolve(rest[2]),
      check,
    };
  }

  if (command === 'verify') {
    if (rest.length !== 1) throw new Error(USAGE);
    // Refused rather than ignored. `verify --check` reads as the stronger
    // reproducibility check and is in fact the weaker integrity one, so
    // accepting the flag would answer a question nobody asked while looking
    // like it answered the one they did.
    if (check) {
      throw new Error(
        'verify takes no --check: verifying an artifact is the check. ' +
          'To confirm the artifact is still reproducible from its inputs, use seal --check.',
      );
    }
    return { command: 'verify', artifactPath: resolve(rest[0]) };
  }

  throw new Error(USAGE);
}

/**
 * The three verbs are the three different claims, and they are not synonyms.
 *
 * `sealed` produced a document. `reproduced` re-derived it from the capture and
 * manifest and got the same bytes. `verified` recomputed the seal of a document
 * held on its own, which says nothing about whether its inputs still produce it.
 */
export interface EvidenceCliOutcome {
  action: 'sealed' | 'reproduced' | 'verified';
  artifact: EvidenceArtifact;
}

async function readText(path: string, what: string) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(`Cannot read the ${what} at ${path}${code ? ` (${code})` : ''}.`);
  }
}

async function sealFromInputs(options: Extract<EvidenceCliOptions, { command: 'seal' }>) {
  const captureText = await readText(options.capturePath, 'capture');

  // Validated up front rather than left to sealing, which would refuse it too.
  // A malformed capture is the most common thing to hand this tool, and
  // `capture-invalid: <one message>` is a worse answer than the list of issues
  // the importer already knows how to produce.
  const imported = importCaptureSession(captureText);
  if (!imported.valid || imported.session === null) {
    throw new Error(
      `The capture at ${options.capturePath} is not a valid capture session:\n${imported.issues
        .map((issue) => `  ${issue.code}@${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
  }

  const manifestText = await readText(options.manifestPath, 'manifest');
  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse(manifestText);
  } catch {
    throw new Error(`The manifest at ${options.manifestPath} is not valid JSON.`);
  }

  const result = await sealEvidenceArtifact(imported.session, manifestInput);
  if (result.sealed === null) {
    throw new Error(
      `Refusing to seal:\n${result.refusals
        .map((refusal) => `  ${refusal.reason}: ${refusal.detail}`)
        .join('\n')}`,
    );
  }

  // Export re-verifies the seal it was just handed. That is not redundant here:
  // these are the exact bytes going to disk, and the artifact is worth nothing
  // if the file cannot be read back by `verify`.
  return { artifact: result.sealed, text: await exportEvidenceArtifact(result.sealed) };
}

export async function runEvidenceCli(options: EvidenceCliOptions): Promise<EvidenceCliOutcome> {
  if (options.command === 'verify') {
    const text = await readText(options.artifactPath, 'artifact');
    const imported = await importEvidenceArtifact(text);
    if (!imported.valid) {
      throw new Error(
        `The artifact at ${options.artifactPath} did not verify:\n${imported.issues
          .map((issue) => `  ${issue}`)
          .join('\n')}`,
      );
    }
    return { action: 'verified', artifact: imported.artifact };
  }

  const { artifact, text } = await sealFromInputs(options);

  if (options.check) {
    let existing: string | null = null;
    try {
      existing = await readFile(options.artifactPath, 'utf8');
    } catch {
      existing = null;
    }
    if (existing === null) {
      throw new Error(
        `No sealed artifact at ${options.artifactPath}. Run without --check to seal one.`,
      );
    }
    if (existing !== text) {
      throw new Error(
        `The sealed artifact at ${options.artifactPath} is not what these inputs produce now. ` +
          'Either an input changed or the processor did. Re-run without --check to reseal, ' +
          'and expect the content hash to change.',
      );
    }
    return { action: 'reproduced', artifact };
  }

  await writeFile(options.artifactPath, text, 'utf8');
  return { action: 'sealed', artifact };
}

/**
 * What the operator is told, as one line plus any notes.
 *
 * A sealed non-result is a success at this boundary. Only `ok` carries a
 * publishable figure, but reporting the others as failures would rebuild the
 * suppression the artifact exists to prevent: under a gate, the walks that went
 * badly would break the build and quietly never be committed, so only the
 * flattering ones would ever survive. Sealing succeeded. What the walk showed is
 * in the document, and the note below says so out loud rather than leaving a
 * bare status to be skimmed past.
 */
export function describeOutcome(outcome: EvidenceCliOutcome): string {
  const { artifact } = outcome;
  const lines = [
    `${outcome.action} ${artifact.capture.sessionId} status=${artifact.evidence.status} (${artifact.contentHash.slice(0, 12)})`,
  ];

  if (artifact.evidence.status !== 'ok') {
    lines.push(
      `  no publishable figure: sealed as ${artifact.evidence.status}, which is a recorded result and not a failure of this tool`,
    );
  }
  if (artifact.manifest.missingScoredCount > 0) {
    lines.push(
      `  ${artifact.manifest.missingScoredCount} of ${artifact.manifest.scoredCount} predeclared scored checkpoint(s) were never walked`,
    );
  }
  return lines.join('\n');
}

async function main() {
  try {
    const options = parseEvidenceArguments(process.argv.slice(2));
    const outcome = await runEvidenceCli(options);
    process.stdout.write(`${describeOutcome(outcome)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
