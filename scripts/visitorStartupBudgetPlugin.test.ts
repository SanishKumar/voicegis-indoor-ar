import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  assertVisitorStartup,
  VISITOR_STARTUP_LIMITS,
  visitorStartupBudgetPlugin,
  visitorStartupReport,
} from './visitorStartupBudgetPlugin.js';

function chunk(
  fileName: string,
  { entry = false, code = 'hello', imports = [], dynamicImports = [], modules = [] } = {} as {
    entry?: boolean;
    code?: string;
    imports?: string[];
    dynamicImports?: string[];
    modules?: string[];
  },
) {
  return {
    type: 'chunk' as const,
    fileName,
    isEntry: entry,
    code,
    imports,
    dynamicImports,
    modules: Object.fromEntries(modules.map((id) => [id, {}])),
  };
}

describe('visitor startup JavaScript budget', () => {
  it('counts every static dependency once, including shared chunks and cycles', () => {
    const bundle = {
      'entry.js': chunk('entry.js', { entry: true, imports: ['a.js', 'b.js'] }),
      'a.js': chunk('a.js', { imports: ['shared.js'] }),
      'b.js': chunk('b.js', { imports: ['shared.js'] }),
      'shared.js': chunk('shared.js', { imports: ['a.js'], code: 'é' }),
      'index.html': { type: 'asset', source: 'not JavaScript' },
    };
    const report = visitorStartupReport(bundle);
    expect(report.files).toEqual(['a.js', 'b.js', 'entry.js', 'shared.js']);
    expect(report.bytes).toBe(3 * Buffer.byteLength('hello') + Buffer.byteLength('é'));
    expect(report.gzipBytes).toBe(3 * gzipSync('hello').byteLength + gzipSync('é').byteLength);
  });

  it('includes all entries but excludes dynamic view code and unrelated workers', () => {
    const report = visitorStartupReport({
      'entry.js': chunk('entry.js', { entry: true, dynamicImports: ['camera.js'] }),
      'other-entry.js': chunk('other-entry.js', { entry: true }),
      'camera.js': chunk('camera.js', { modules: ['/repo/node_modules/three/src/Three.js'] }),
      'routing.worker.js': { type: 'asset', source: 'worker' },
    });
    expect(report.files).toEqual(['entry.js', 'other-entry.js']);
    expect(report.forbiddenModules).toEqual([]);
  });

  it.each([
    '/repo/src/components/CameraPreview.jsx',
    'D:\\repo\\src\\ar\\arSession.ts',
    '/repo/node_modules/three/build/three.module.js?commonjs-proxy',
    '/repo/node_modules/.pnpm/three@0.184.0/node_modules/three/src/Three.js',
  ])('rejects eager view dependencies even through another chunk: %s', (id) => {
    const report = visitorStartupReport({
      'entry.js': chunk('entry.js', { entry: true, imports: ['shared.js'] }),
      'shared.js': chunk('shared.js', { modules: [id] }),
    });
    expect(() => assertVisitorStartup(report)).toThrow('must stay deferred');
  });

  it('fails closed if entry points or static dependencies cannot be measured', () => {
    expect(() => visitorStartupReport({})).toThrow('no JavaScript entry');
    expect(() =>
      visitorStartupReport({
        'entry.js': chunk('entry.js', { entry: true, imports: ['https://cdn.test/code.js'] }),
      }),
    ).toThrow('outside the build');
  });

  it('checks raw and compressed sizes independently and accepts the exact limits', () => {
    const report = { files: ['entry.js'], forbiddenModules: [], ...VISITOR_STARTUP_LIMITS };
    expect(() => assertVisitorStartup(report)).not.toThrow();
    expect(() => assertVisitorStartup({ ...report, bytes: report.bytes + 1 })).toThrow('budget');
    expect(() => assertVisitorStartup({ ...report, gzipBytes: report.gzipBytes + 1 })).toThrow(
      'budget',
    );
  });

  it('runs in the public build only, without imposing a visitor budget on operator tools', () => {
    const bundle = { 'entry.js': chunk('entry.js', { entry: true }) };
    const info = vi.fn();
    visitorStartupBudgetPlugin(true).generateBundle.call({ info }, {}, bundle);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Public startup JS:'));
    visitorStartupBudgetPlugin(false).generateBundle.call({ info }, {}, {});
    expect(info).toHaveBeenCalledTimes(1);
  });
});
