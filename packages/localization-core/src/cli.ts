import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { replayRecording } from './replay';
import type { LocalizationRecording } from './types';

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const [inputArgument, outputArgument, checkArgument] = process.argv.slice(2);
  if (!inputArgument || !outputArgument) {
    throw new Error('Usage: localization-replay <recording.json> <report.json> [--check]');
  }
  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);
  const recording = JSON.parse(await readFile(inputPath, 'utf8')) as LocalizationRecording;
  const reportText = stableJson(replayRecording(recording).report);

  if (checkArgument === '--check') {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== reportText) throw new Error(`Replay report is stale: ${outputPath}.`);
    process.stdout.write(`verified replay ${recording.sessionId}\n`);
    return;
  }

  await writeFile(outputPath, reportText, 'utf8');
  process.stdout.write(`replayed ${recording.sessionId}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
