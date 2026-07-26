import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const checkOnly = process.argv.includes('--check');
const artifacts = [
  {
    source: 'buildings/asterion-medical-center/compiled/building.package.json',
    target: 'public/venues/asterion-medical-center.package.json',
  },
  {
    source: 'buildings/harbor-exchange/compiled/building.package.json',
    target: 'public/venues/harbor-exchange.package.json',
  },
];

let failed = false;
for (const artifact of artifacts) {
  const sourcePath = resolve(artifact.source);
  const targetPath = resolve(artifact.target);
  const source = await readFile(sourcePath);

  if (checkOnly) {
    try {
      const target = await readFile(targetPath);
      if (!source.equals(target)) {
        console.error(`Runtime artifact is stale: ${artifact.target}`);
        failed = true;
      }
    } catch {
      console.error(`Runtime artifact is missing: ${artifact.target}`);
      failed = true;
    }
    continue;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source);
  console.log(`Synced ${artifact.target}`);
}

if (failed) process.exitCode = 1;
