import { describe, expect, it } from 'vitest';
import { LocalizationRuntimeController } from './runtimeState';
import type { LocalizationEstimate } from './types';

function estimate(
  quality: LocalizationEstimate['quality'],
  timeMs: number,
  overrides: Partial<LocalizationEstimate> = {},
): LocalizationEstimate {
  return {
    timeMs,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    headingDegrees: 0,
    floorId: 'g',
    covariance: [],
    positionSigmaMeters: quality === 'high' ? 0.3 : 2,
    headingSigmaDegrees: 5,
    lastCorrectionTimeMs: timeMs,
    observationSources: ['inertial'],
    quality,
    ...overrides,
  };
}

describe('localization runtime recovery state', () => {
  it('maps high and degraded estimates to active and caution guidance', () => {
    const runtime = new LocalizationRuntimeController();
    expect(runtime.update(estimate('high', 0))).toMatchObject({
      localizationState: 'tracking',
      guidanceState: 'active',
    });
    expect(runtime.update(estimate('degraded', 1_000))).toMatchObject({
      localizationState: 'degraded',
      guidanceState: 'caution',
    });
  });

  it('freezes guidance on loss and does not silently recover on a plausible estimate', () => {
    const runtime = new LocalizationRuntimeController();
    runtime.update(estimate('high', 0));
    expect(runtime.update(estimate('lost', 10_000))).toMatchObject({
      localizationState: 'lost',
      guidanceState: 'frozen',
      lostAtMs: 10_000,
    });
    expect(runtime.update(estimate('high', 11_000))).toMatchObject({
      localizationState: 'relocalizing',
      guidanceState: 'frozen',
    });
  });

  it('requires a recent trusted anchor and records recovery duration', () => {
    const runtime = new LocalizationRuntimeController();
    runtime.update(estimate('high', 0));
    runtime.update(estimate('lost', 10_000));
    runtime.beginRelocalization(10_500);

    expect(() => runtime.confirmRelocalization(estimate('high', 12_000), 'anchor-a')).toThrow(
      'trusted anchor',
    );

    const recovered = runtime.confirmRelocalization(
      estimate('high', 13_000, {
        lastCorrectionTimeMs: 12_500,
        observationSources: ['inertial', 'visual-anchor'],
      }),
      'anchor-ground-junction',
    );
    expect(recovered).toMatchObject({
      localizationState: 'tracking',
      guidanceState: 'active',
      recoveryDurationMs: 3_000,
      recoveryAnchorId: 'anchor-ground-junction',
    });
  });

  it('rejects stale anchor corrections', () => {
    const runtime = new LocalizationRuntimeController({ maximumAnchorAgeMs: 1_000 });
    runtime.update(estimate('lost', 1_000));
    runtime.beginRelocalization(1_500);

    expect(() =>
      runtime.confirmRelocalization(
        estimate('high', 4_000, {
          lastCorrectionTimeMs: 2_000,
          observationSources: ['visual-anchor'],
        }),
        'stale-anchor',
      ),
    ).toThrow('too old');
  });
});
