/*
 * Prints the written directions for one trip through a compiled venue.
 *
 *   npx tsx scripts/printRoute.ts meridian-park-campus poi-l2-dialysis poi-w-gym
 *   npx tsx scripts/printRoute.ts asterion-medical-center <from-poi> <to-poi> --step-free
 *
 * For reading a route as a visitor would be told it, without opening the app.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { calculateCompiledRoute } from '../src/engine/compiledRoutePolicy';
import { createCompiledBuildingRuntime } from '../src/data/compiledBuilding';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [venueId, from, to, ...flags] = process.argv.slice(2);
if (!venueId || !from || !to) {
  console.error(
    'usage: tsx scripts/printRoute.ts <venue-id> <from-poi-id> <to-poi-id> [--step-free]',
  );
  process.exit(1);
}
const buildingPackage = JSON.parse(
  readFileSync(path.join(root, 'buildings', venueId, 'compiled', 'building.package.json'), 'utf8'),
) as CompiledBuildingPackage;
const runtime = createCompiledBuildingRuntime(buildingPackage);
const route = calculateCompiledRoute(runtime, `poi:${from}`, `poi:${to}`, {
  accessibleOnly: flags.includes('--step-free'),
});
if (!route.found) {
  console.error(`No route from ${from} to ${to}.`);
  process.exit(1);
}
console.log(`${Math.round(route.totalDistance)} m, ${route.steps.length} steps`);
for (const step of route.steps) {
  console.log(`  ${String(Math.round(step.distance)).padStart(4)} m  ${step.instruction}`);
}
