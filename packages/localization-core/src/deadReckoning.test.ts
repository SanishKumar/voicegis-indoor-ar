import { describe, expect, it } from 'vitest';
import { DeadReckoningIntegrator, type ImuSample } from './deadReckoning';
import { LocalizationFilter } from './filter';

const GRAVITY = 9.81;

/** Synthesises a steady walk: one acceleration peak per stride. */
function walkingSamples({
  durationMs,
  sampleMs = 20,
  stepPeriodMs = 500,
  amplitude = 3,
  headingRateDegreesPerSecond = 0,
  startTimeMs = 0,
}: {
  durationMs: number;
  sampleMs?: number;
  stepPeriodMs?: number;
  amplitude?: number;
  headingRateDegreesPerSecond?: number;
  startTimeMs?: number;
}): ImuSample[] {
  const samples: ImuSample[] = [];
  for (let elapsed = 0; elapsed <= durationMs; elapsed += sampleMs) {
    samples.push({
      timeMs: startTimeMs + elapsed,
      accelerationMagnitude: GRAVITY + amplitude * Math.sin((2 * Math.PI * elapsed) / stepPeriodMs),
      headingRateDegreesPerSecond,
    });
  }
  return samples;
}

function runAll(integrator: DeadReckoningIntegrator, samples: ImuSample[]) {
  return samples.flatMap((sample) => integrator.push(sample));
}

describe('IMU dead reckoning', () => {
  it('counts one step per stride without double counting a footfall', () => {
    const integrator = new DeadReckoningIntegrator();
    runAll(integrator, walkingSamples({ durationMs: 5_000, stepPeriodMs: 500 }));

    // Ten stride periods in five seconds; allow one at each boundary.
    expect(integrator.steps).toBeGreaterThanOrEqual(9);
    expect(integrator.steps).toBeLessThanOrEqual(11);
  });

  it('ignores jitter that never rises past the footfall threshold', () => {
    const integrator = new DeadReckoningIntegrator();
    runAll(integrator, walkingSamples({ durationMs: 5_000, amplitude: 0.4 }));

    expect(integrator.steps).toBe(0);
  });

  it('refuses to count two steps inside the refractory period', () => {
    const integrator = new DeadReckoningIntegrator({ minimumStepIntervalMs: 400 });
    // A 200ms stride period is faster than any real walk and would otherwise
    // register roughly twice as many steps.
    runAll(integrator, walkingSamples({ durationMs: 4_000, stepPeriodMs: 200 }));

    expect(integrator.steps).toBeLessThanOrEqual(4_000 / 400 + 1);
  });

  it('integrates yaw rate into heading', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 0);
    runAll(
      integrator,
      walkingSamples({ durationMs: 1_000, headingRateDegreesPerSecond: 90, amplitude: 0.1 }),
    );

    expect(integrator.heading).toBeCloseTo(90, 0);
  });

  it('wraps heading rather than letting it run past a full turn', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 350);
    runAll(
      integrator,
      walkingSamples({ durationMs: 1_000, headingRateDegreesPerSecond: 30, amplitude: 0.1 }),
    );

    expect(integrator.heading).toBeGreaterThanOrEqual(0);
    expect(integrator.heading).toBeLessThan(360);
    expect(integrator.heading).toBeCloseTo(20, 0);
  });

  it('re-seeds integrated heading when a checkpoint reports the truth', () => {
    const integrator = new DeadReckoningIntegrator({}, 0, 0);
    runAll(
      integrator,
      walkingSamples({ durationMs: 4_000, headingRateDegreesPerSecond: 5, amplitude: 0.1 }),
    );
    const drifted = integrator.heading;

    // Dead reckoning drifts without bound; a scan is what stops it.
    expect(drifted).toBeGreaterThan(15);
    integrator.syncHeading(180);
    expect(integrator.heading).toBe(180);
  });

  it('emits heading no more often than the configured interval', () => {
    const integrator = new DeadReckoningIntegrator({ headingEmitIntervalMs: 1_000 });
    const observations = runAll(
      integrator,
      walkingSamples({ durationMs: 5_000, amplitude: 0.1 }),
    );
    const headings = observations.filter((o) => o.kind === 'heading');

    expect(headings.length).toBeGreaterThanOrEqual(5);
    expect(headings.length).toBeLessThanOrEqual(7);
  });

  it('produces identical observations for identical samples', () => {
    const samples = walkingSamples({ durationMs: 3_000, headingRateDegreesPerSecond: 12 });

    expect(runAll(new DeadReckoningIntegrator(), samples)).toEqual(
      runAll(new DeadReckoningIntegrator(), samples),
    );
  });

  it('walks the filter forward along the heading it was seeded with', () => {
    const filter = new LocalizationFilter();
    filter.apply({
      kind: 'initial-fix',
      sequence: 0,
      timeMs: 0,
      source: 'manual-anchor',
      position: [0, 0],
      floorId: 'g',
      elevationMeters: 0,
      headingDegrees: 90,
      accuracyMeters: 0.2,
      headingAccuracyDegrees: 10,
    });

    // Heading 90 degrees is east, so only X should grow.
    const integrator = new DeadReckoningIntegrator({}, 1, 90);
    let estimate = null;
    for (const sample of walkingSamples({ durationMs: 4_000, startTimeMs: 100 })) {
      for (const observation of integrator.push(sample)) {
        estimate = filter.apply(observation);
      }
    }

    expect(integrator.steps).toBeGreaterThan(4);
    expect(estimate!.position[0]).toBeGreaterThan(1);
    expect(Math.abs(estimate!.position[1])).toBeLessThan(1);
    expect(estimate!.observationSources).toContain('pedometer');
  });
});
