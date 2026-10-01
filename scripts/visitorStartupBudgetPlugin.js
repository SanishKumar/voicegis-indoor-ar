import { gzipSync } from 'node:zlib';

// This budgets the public shell's synchronous JavaScript, not map/AR downloads
// or the offline installation. Leave headroom for small visitor features.
export const VISITOR_STARTUP_LIMITS = Object.freeze({
  bytes: 500 * 1024,
  gzipBytes: 170 * 1024,
});

function isDeferredModule(moduleId) {
  const id = moduleId.replaceAll('\\', '/').split('?')[0];
  return (
    id.endsWith('/src/components/CameraPreview.jsx') ||
    id.endsWith('/src/ar/arSession.ts') ||
    id.includes('/node_modules/three/')
  );
}

/** Follow static imports only; shared chunks are counted once even in a cycle. */
export function visitorStartupReport(bundle) {
  const pending = Object.values(bundle)
    .filter((output) => output.type === 'chunk' && output.isEntry)
    .map((output) => output.fileName);
  if (pending.length === 0) throw new Error('Public build has no JavaScript entry to budget.');

  const visited = new Set();
  const forbiddenModules = new Set();
  let bytes = 0;
  let gzipBytes = 0;
  while (pending.length > 0) {
    const fileName = pending.pop();
    if (visited.has(fileName)) continue;
    const output = bundle[fileName];
    if (!output || output.type !== 'chunk') {
      throw new Error(`Public startup imports JavaScript outside the build: ${fileName}`);
    }
    visited.add(fileName);
    bytes += Buffer.byteLength(output.code);
    gzipBytes += gzipSync(output.code).byteLength;
    Object.keys(output.modules)
      .filter(isDeferredModule)
      .forEach((id) => forbiddenModules.add(id));
    pending.push(...output.imports);
  }
  return {
    files: [...visited].sort(),
    bytes,
    gzipBytes,
    forbiddenModules: [...forbiddenModules].sort(),
  };
}

export function assertVisitorStartup(report, limits = VISITOR_STARTUP_LIMITS) {
  if (report.forbiddenModules.length > 0) {
    throw new Error(
      `Public startup eagerly imports map/AR code that must stay deferred: ${report.forbiddenModules.join(', ')}`,
    );
  }
  if (report.bytes > limits.bytes || report.gzipBytes > limits.gzipBytes) {
    throw new Error(
      `Public startup JavaScript exceeds its budget: ${report.bytes}/${limits.bytes} bytes, ${report.gzipBytes}/${limits.gzipBytes} gzip bytes. Inspect static imports before increasing the limits.`,
    );
  }
}

export function visitorStartupBudgetPlugin(enabled) {
  return {
    name: 'voicegis-visitor-startup-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!enabled) return;
      const report = visitorStartupReport(bundle);
      assertVisitorStartup(report);
      this.info(
        `Public startup JS: ${(report.bytes / 1024).toFixed(1)} KiB / ${(report.gzipBytes / 1024).toFixed(1)} KiB gzip (limits 500 / 170 KiB).`,
      );
    },
  };
}
