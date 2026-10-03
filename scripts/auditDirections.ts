/*
 * Reads every trip a venue can give - each public place to each other - and
 * reports the ones a visitor would find wrong: no route, a turn back the way
 * they came, the same sentence twice.
 *
 *   npx tsx scripts/auditDirections.ts meridian-park-campus
 *
 * The same checks run in src/data/venueDirections.test.ts, which stops at the
 * first. This lists all of them, for fixing a venue in one pass.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { calculateCompiledRoute } from '../src/engine/compiledRoutePolicy';
import { createCompiledBuildingRuntime } from '../src/data/compiledBuilding';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venueId = process.argv[2];
if (!venueId) {
  console.error('usage: tsx scripts/auditDirections.ts <venue-id>');
  process.exit(1);
}
const buildingPackage = JSON.parse(
  readFileSync(path.join(root, 'buildings', venueId, 'compiled', 'building.package.json'), 'utf8'),
) as CompiledBuildingPackage;
const runtime = createCompiledBuildingRuntime(buildingPackage);
const places = runtime.getPOIs().map((node) => node.id);

const faults = new Map<string, string[]>();
const fault = (what: string, trip: string) => {
  const trips = faults.get(what) ?? [];
  trips.push(trip);
  faults.set(what, trips);
};
let trips = 0;
let longest = { metres: 0, steps: 0, trip: '' };
for (const profile of ['fastest', 'step-free'] as const) {
  for (const from of places) {
    for (const to of places) {
      if (from === to) continue;
      trips += 1;
      const trip = `${from.slice(4)} -> ${to.slice(4)} (${profile})`;
      const route = calculateCompiledRoute(runtime, from, to, {
        accessibleOnly: profile === 'step-free',
      });
      if (!route.found) {
        fault('no route', trip);
        continue;
      }
      if (route.totalDistance > longest.metres) {
        longest = { metres: route.totalDistance, steps: route.steps.length, trip };
      }
      route.steps.forEach((step, index) => {
        if (step.type === 'u_turn') fault(`turns back: "${step.instruction}"`, trip);
        if (index > 0 && step.instruction === route.steps[index - 1].instruction) {
          fault(`says twice: "${step.instruction}"`, trip);
        }
        if (profile === 'step-free' && (step.type === 'stairs' || step.type === 'escalator')) {
          fault(`step-free by "${step.instruction}"`, trip);
        }
      });
    }
  }
}

console.log(`${venueId}: ${places.length} places, ${trips} trips`);
console.log(`longest: ${Math.round(longest.metres)} m in ${longest.steps} steps, ${longest.trip}`);
if (faults.size === 0) {
  console.log('nothing wrong found');
} else {
  for (const [what, found] of faults) {
    console.log(`${found.length} x ${what}`);
    for (const trip of found.slice(0, 3)) console.log(`     ${trip}`);
  }
  process.exit(1);
}
