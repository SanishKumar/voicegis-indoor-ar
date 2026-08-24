// @ts-check

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewUrl = 'http://127.0.0.1:4187/venues/catalog.json';
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');

/** @type {import('node:child_process').ChildProcess | null} */
let runner = null;
const preview = spawn(
  process.execPath,
  [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4187', '--strictPort'],
  {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  },
);

preview.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));

async function waitForPreview() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`production preview exited before it became ready (${preview.exitCode})`);
    }
    try {
      const response = await fetch(previewUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The server is still starting. Readiness is bounded by the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`production preview was not ready within 60 seconds: ${previewUrl}`);
}

async function stopPreview() {
  if (preview.exitCode !== null || preview.signalCode !== null) return;
  const exited = once(preview, 'exit');
  preview.kill();
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!stopped && preview.exitCode === null && preview.signalCode === null) {
    const forceExited = once(preview, 'exit');
    preview.kill('SIGKILL');
    await forceExited;
  }
}

/** @param {NodeJS.Signals} signal */
function forwardSignal(signal) {
  runner?.kill(signal);
  preview.kill(signal);
}

process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

try {
  await waitForPreview();
  runner = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  const [code, signal] = await once(runner, 'exit');
  if (signal !== null) {
    process.stderr.write(`Playwright was terminated by ${signal}.\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
} finally {
  await stopPreview();
}
