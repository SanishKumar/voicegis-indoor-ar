// @ts-check

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { announcesPreviewOn } from './previewReadyLine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewPort = 4187;
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const commandArguments = process.argv.slice(2);
const publicBuild = commandArguments.includes('--public-build');
/*
 * `--base=/name/` builds and serves the app under a sub-path, as a project
 * site such as GitHub Pages hosts it. The suites written against the domain
 * root are not meant for that; e2e/subpath.pw.ts is.
 */
const baseArgument = commandArguments.find((argument) => argument.startsWith('--base='));
const base = baseArgument === undefined ? '/' : baseArgument.slice('--base='.length);
const previewUrl = `http://127.0.0.1:${previewPort}${base}venues/catalog.json`;
const playwrightArguments = commandArguments.filter(
  (argument) => argument !== '--public-build' && argument !== baseArgument,
);

/** @type {import('node:child_process').ChildProcess | null} */
let builder = null;
/** @type {import('node:child_process').ChildProcess | null} */
let preview = null;
/** @type {import('node:child_process').ChildProcess | null} */
let runner = null;
/** @type {Promise<undefined> | null} */
let previewReady = null;

/** @param {import('node:child_process').ChildProcess} child */
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve([code, signal]));
  });
}

/** @param {import('node:child_process').ChildProcess} child @param {string} label */
async function requireSuccess(child, label) {
  const [code, signal] = await waitForExit(child);
  if (signal !== null) throw new Error(`${label} was terminated by ${signal}`);
  if (code !== 0) throw new Error(`${label} exited with code ${code ?? 'unknown'}`);
}

/** @param {string} outDir */
function startPreview(outDir) {
  preview = spawn(
    process.execPath,
    [
      viteCli,
      'preview',
      '--outDir',
      outDir,
      '--host',
      '127.0.0.1',
      '--port',
      String(previewPort),
      '--strictPort',
      '--base',
      base,
    ],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  preview.stderr?.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));

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
  previewReady = new Promise((resolve, reject) => {
    let output = '';
    let ready = false;

    preview?.stdout?.on('data', (chunk) => {
      output = `${output}${String(chunk)}`.slice(-8_000);
      if (!ready && announcesPreviewOn(output, previewPort)) {
        ready = true;
        resolve(undefined);
      }
    });

    preview?.once('error', reject);
    preview?.once('exit', (code, signal) => {
      if (ready) return;
      reject(
        new Error(
          `production preview exited before it became ready (${signal ?? code ?? 'unknown'})`,
        ),
      );
    });
  });
}

async function waitForPreview() {
  if (previewReady === null) throw new Error('production preview was not started');
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
  if (preview === null) return;
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
  builder?.kill(signal);
  runner?.kill(signal);
  preview?.kill(signal);
}

process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'voicegis-browser-smoke-'));
const outDir = path.join(temporaryRoot, 'dist');
try {
  builder = spawn(
    process.execPath,
    [
      viteCli,
      'build',
      '--mode',
      publicBuild ? 'public' : 'operator',
      '--outDir',
      outDir,
      '--emptyOutDir',
      '--base',
      base,
    ],
    {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  await requireSuccess(builder, 'production build');

  startPreview(outDir);
  await waitForPreview();
  runner = spawn(process.execPath, [playwrightCli, 'test', ...playwrightArguments], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      VOICEGIS_PUBLIC_SMOKE: publicBuild ? 'true' : 'false',
      // Public-only failure tests deliberately mutate one file in this
      // throwaway build. They never touch the repository or another run's
      // output, because every invocation owns a distinct temporary directory.
      VOICEGIS_SMOKE_OUT_DIR: outDir,
      VOICEGIS_SMOKE_BASE: base,
    },
  });
  const [code, signal] = await waitForExit(runner);
  if (signal !== null) {
    process.stderr.write(`Playwright was terminated by ${signal}.\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
} finally {
  await stopPreview();
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
