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
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

preview.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));

/**
 * Readiness belongs to the process this runner spawned.
 *
 * An HTTP-only probe accepted any server already listening on 4187. If this
 * Vite process lost the strict-port race, the probe could still return 200
 * before its exit event arrived, and Playwright attached to a server this run
 * did not own. When that other run ended, the suite lost its server halfway
 * through. Wait for this process's own ready line first; only then use HTTP to
 * confirm the advertised endpoint responds.
 */
const previewReady = new Promise((resolve, reject) => {
  let output = '';
  let ready = false;

  preview.stdout.on('data', (chunk) => {
    output = `${output}${String(chunk)}`.slice(-8_000);
    if (!ready && /Local:\s+http:\/\/127\.0\.0\.1:4187\//.test(output)) {
      ready = true;
      resolve(undefined);
    }
  });

  preview.once('error', reject);
  preview.once('exit', (code, signal) => {
    if (ready) return;
    reject(
      new Error(
        `production preview exited before it became ready (${signal ?? code ?? 'unknown'})`,
      ),
    );
  });
});

async function waitForPreview() {
  /** @type {NodeJS.Timeout | undefined} */
  let deadline;
  try {
    await Promise.race([
      previewReady,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error(`production preview was not ready within 60 seconds`)),
          60_000,
        );
      }),
    ]);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }

  const response = await fetch(previewUrl, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) {
    throw new Error(`production preview readiness endpoint returned ${response.status}`);
  }
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
