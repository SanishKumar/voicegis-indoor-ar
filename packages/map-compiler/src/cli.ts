import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileBuilding, stableJson } from './compiler';

export interface CompilerCliOptions {
  sourcePath: string;
  outputDirectory: string;
  check: boolean;
}

export function parseCompilerArguments(args: string[]): CompilerCliOptions {
  const check = args.includes('--check');
  const positional = args.filter((argument) => argument !== '--check');
  if (positional.length !== 2) {
    throw new Error('Usage: map-compiler <source.json> <output-directory> [--check]');
  }
  return {
    sourcePath: resolve(positional[0]),
    outputDirectory: resolve(positional[1]),
    check,
  };
}

async function matchesFile(path: string, expected: string) {
  try {
    return (await readFile(path, 'utf8')) === expected;
  } catch {
    return false;
  }
}

export async function runCompilerCli(options: CompilerCliOptions) {
  const sourceText = await readFile(options.sourcePath, 'utf8');
  const source: unknown = JSON.parse(sourceText);
  const result = compileBuilding(source);
  const reportPath = resolve(options.outputDirectory, 'validation-report.json');
  const packagePath = resolve(options.outputDirectory, 'building.package.json');
  const reportText = stableJson(result.report);
  const packageText = result.package ? stableJson(result.package) : null;

  if (options.check) {
    const reportMatches = await matchesFile(reportPath, reportText);
    const packageMatches = packageText ? await matchesFile(packagePath, packageText) : true;
    if (!reportMatches || !packageMatches) {
      throw new Error('Compiled building artifacts are stale. Run the compiler without --check.');
    }
  } else {
    await mkdir(options.outputDirectory, { recursive: true });
    await writeFile(reportPath, reportText, 'utf8');
    if (packageText) await writeFile(packagePath, packageText, 'utf8');
  }

  if (!result.report.valid) {
    throw new Error(
      `Building compilation failed with ${result.report.summary.errors} validation error(s).`,
    );
  }

  return result;
}

async function main() {
  try {
    const options = parseCompilerArguments(process.argv.slice(2));
    const result = await runCompilerCli(options);
    const action = options.check ? 'verified' : 'compiled';
    console.log(
      `${action} ${result.package?.building.id} (${result.package?.manifest.contentHash.slice(0, 12)})`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
