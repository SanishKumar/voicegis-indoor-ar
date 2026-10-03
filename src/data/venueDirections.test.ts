import { describe, expect, it } from 'vitest';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import reference from '../../buildings/reference-medical-centre/compiled/building.package.json';
import asterion from '../../buildings/asterion-medical-center/compiled/building.package.json';
import harbor from '../../buildings/harbor-exchange/compiled/building.package.json';
import campus from '../../buildings/meridian-park-campus/compiled/building.package.json';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { createCompiledBuildingRuntime } from './compiledBuilding';

/*
 * Every trip a visitor can ask for, in every venue: from each public place to
 * each other, by the fastest way and by the step-free one. A route that
 * works between two rooms someone thought to try says nothing about the
 * thousand pairs nobody did.
 */

const VENUES = { reference, asterion, harbor, campus } as unknown as Record<
  string,
  CompiledBuildingPackage
>;

/** The space a step names, with the word that says how it is entered. */
function named(instruction: string) {
  const match = / (on|onto|into|along|through) ([^,]+?)(?:,|$)/.exec(instruction);
  return match === null ? null : { how: match[1], space: match[2] };
}

for (const [name, venue] of Object.entries(VENUES)) {
  // Thousands of routes a venue: worked out once each and read by every test.
  describe(`directions in ${name}`, { timeout: 60_000 }, () => {
    const runtime = createCompiledBuildingRuntime(venue);
    const worked = new Map<string, ReturnType<typeof calculateCompiledRoute>>();
    const trip = (from: string, to: string, accessibleOnly = false) => {
      const key = `${from}>${to}>${accessibleOnly}`;
      let route = worked.get(key);
      if (route === undefined) {
        route = calculateCompiledRoute(runtime, from, to, { accessibleOnly });
        worked.set(key, route);
      }
      return route;
    };
    const places = runtime.getPOIs().map((node) => node.id);
    const spaceType = new Map(venue.spaces.map((space) => [space.name, space.type]));
    const pairs = places.flatMap((from) =>
      places.filter((to) => to !== from).map((to) => [from, to] as const),
    );

    it('has a route between every two public places', () => {
      expect(pairs.length).toBeGreaterThan(0);
      for (const [from, to] of pairs) {
        const route = trip(from, to);
        expect(route.found, `${from} to ${to}`).toBe(true);
      }
    });

    it('starts where it is asked to, ends where it is asked to, and covers ground in between', () => {
      for (const [from, to] of pairs) {
        const route = trip(from, to);
        if (!route.found) continue;
        expect(route.pathIds[0], `${from} to ${to}`).toBe(from);
        expect(route.pathIds[route.pathIds.length - 1], `${from} to ${to}`).toBe(to);
        expect(route.totalDistance, `${from} to ${to}`).toBeGreaterThan(0);
        expect(route.steps[0].instruction).toMatch(/^Start at /);
        expect(route.steps[route.steps.length - 1].instruction).toMatch(/^Arrive at /);
        // The steps add up to the trip: nothing walked is left unsaid.
        const said = route.steps.reduce((total, step) => total + step.distance, 0);
        expect(Math.abs(said - route.totalDistance), `${from} to ${to}`).toBeLessThan(0.5);
      }
    });

    it('never tells a visitor to turn onto the corridor they are already in', () => {
      for (const [from, to] of pairs) {
        const route = trip(from, to);
        if (!route.found) continue;
        let standing: string | null = null;
        for (const step of route.steps) {
          const place = named(step.instruction);
          if (place === null) {
            // A lift or a stair: wherever it lets out is somewhere new.
            if (/^Take /.test(step.instruction)) standing = null;
            continue;
          }
          if (place.how === 'onto' || place.how === 'into') {
            expect(place.space, `${from} to ${to}: "${step.instruction}"`).not.toBe(standing);
          }
          // Where the start is standing is not said in so many words.
          if (place.how === 'along' && standing !== null) {
            expect(place.space, `${from} to ${to}: "${step.instruction}"`).toBe(standing);
          }
          standing = place.space;
        }
      }
    });

    it('walks along a corridor and into a room, and says which', () => {
      for (const [from, to] of pairs) {
        const route = trip(from, to);
        if (!route.found) continue;
        for (const step of route.steps) {
          const place = named(step.instruction);
          if (place === null || /^Start at /.test(step.instruction)) continue;
          const type = spaceType.get(place.space);
          if (type === undefined) continue;
          if (place.how === 'onto') {
            expect(type, `"${step.instruction}"`).toBe('corridor');
          }
          if (place.how === 'into') {
            expect(type, `"${step.instruction}"`).not.toBe('corridor');
          }
        }
      }
    });

    it('never sends a visitor one way only to turn them round', () => {
      // A place is reached through the middle of its space. One pinned far
      // from the middle sends every route in to the middle and back out.
      for (const [from, to] of pairs) {
        const route = trip(from, to);
        if (!route.found) continue;
        for (const step of route.steps) {
          expect(step.type, `${from} to ${to}: "${step.instruction}"`).not.toBe('u_turn');
        }
      }
    });

    it('does not make a manoeuvre of the last step to the door', () => {
      for (const [from, to] of pairs) {
        const route = trip(from, to);
        if (!route.found || route.steps.length < 3) continue;
        const last = route.steps[route.steps.length - 2];
        if (last.type === 'straight' || last.type === 'start') continue;
        if (['elevator', 'stairs', 'ramp', 'escalator'].includes(last.type)) continue;
        expect(last.distance, `${from} to ${to}: "${last.instruction}"`).toBeGreaterThan(2.4);
      }
    });

    it('never says the same thing twice running', () => {
      for (const [from, to] of pairs) {
        const route = trip(from, to);
        if (!route.found) continue;
        route.steps.forEach((step, index) => {
          if (index === 0) return;
          expect(step.instruction, `${from} to ${to}, step ${index}`).not.toBe(
            route.steps[index - 1].instruction,
          );
        });
      }
    });

    it('keeps a step-free route off the stairs, wherever one exists', () => {
      let found = 0;
      for (const [from, to] of pairs) {
        const route = trip(from, to, true);
        if (!route.found) continue;
        found += 1;
        for (const step of route.steps) {
          expect(step.type, `${from} to ${to}: "${step.instruction}"`).not.toBe('stairs');
          expect(step.type).not.toBe('escalator');
        }
      }
      expect(found).toBeGreaterThan(0);
    });
  });
}

describe('a trip between buildings on the campus', () => {
  const runtime = createCompiledBuildingRuntime(VENUES.campus);
  const said = (from: string, to: string, accessibleOnly = false) => {
    const route = calculateCompiledRoute(runtime, `poi:${from}`, `poi:${to}`, { accessibleOnly });
    if (!route.found) throw new Error(`no route from ${from} to ${to}`);
    return route.steps.map((step) => step.instruction);
  };

  it('goes from a room upstairs in one building to a room in another, floor by floor', () => {
    expect(said('poi-l2-dialysis', 'poi-w-gym')).toEqual([
      'Start at Dialysis Unit',
      'Continue on Level 2 Concourse',
      'Turn right at Sky Terrace',
      'Turn right into Level 2 Stair Hall',
      'Take Main Stairs to Ground · Campus',
      'Continue through Main Stair Hall, past Laboratory',
      'Continue on Main Concourse',
      'Turn left at Hospital Main Entrance',
      'Turn right into Main Entrance Hall',
      'Continue on Hospital Forecourt',
      'Continue on Fountain Court',
      'Turn left at Central Fountain',
      'Turn right along Fountain Court',
      'Turn left onto East Garden Walk',
      'Continue into Pavilion Entrance',
      'Continue on Pavilion Gallery',
      'Turn right at Wellness Pavilion Entrance',
      'Turn left into Rehabilitation Gym',
      'Arrive at Rehabilitation Gym, on your left',
    ]);
  });

  it('takes the lift when asked for a step-free way, and says so', () => {
    const steps = said('poi-l2-dialysis', 'poi-w-gym', true);
    expect(steps).toContain('Take Main Lifts to Ground · Campus');
    expect(steps.join('\n')).not.toMatch(/Stairs/);
    expect(steps[steps.length - 1]).toBe('Arrive at Rehabilitation Gym, on your left');
  });

  it('goes up to a room on every upper floor from every building', () => {
    for (const from of ['poi-e-triage', 'poi-w-gym', 'poi-main-gate', 'poi-g-cafe']) {
      for (const [to, floor] of [
        ['poi-l1-maternity', 'Level 1 · Women & Children'],
        ['poi-l2-cardiac-ward', 'Level 2 · Wards & Research'],
      ]) {
        const steps = said(from, to);
        // One change of floor, by the stairs or the lift, straight to it.
        const climbs = steps.filter((step) => /^Take Main (Stairs|Lifts) to /.test(step));
        expect(climbs, `${from} to ${to}:\n${steps.join('\n')}`).toHaveLength(1);
        expect(climbs[0]).toMatch(new RegExp(` to ${floor}$`));
      }
    }
  });

  it('leaves the car park by the way out, not by way of its middle', () => {
    const steps = said('poi-car-park', 'poi-fountain');
    expect(steps.slice(0, 3)).toEqual([
      'Start at Visitor Car Park',
      'Continue on Car Park Walk',
      'Continue on Garden Promenade',
    ]);
    // Two right turns round the court are two sentences, not one said twice.
    expect(steps).toContain('Turn right along Fountain Court');
    expect(steps).toContain('Turn right again along Fountain Court');
  });

  it('does not name a landmark that the step has already named', () => {
    const steps = said('poi-e-triage', 'poi-l1-maternity', true);
    expect(steps).toContain('Turn left into Emergency Entrance');
    expect(steps).toContain('Continue into Main Entrance Hall');
  });
});
