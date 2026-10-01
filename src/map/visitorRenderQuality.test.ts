import { describe, expect, it } from 'vitest';
import { createVisitorRenderQuality } from './visitorRenderQuality';

describe('visitor render quality policy', () => {
  it('does not guess a constrained device from missing or invalid hints', () => {
    for (const hints of [{}, { memoryGiB: NaN, cores: 0 }, { memoryGiB: -1, cores: Infinity }]) {
      expect(createVisitorRenderQuality(hints).read()).toEqual({
        setting: 'auto',
        level: 'full',
        reason: 'default',
      });
    }
  });
  it.each([{ memoryGiB: 2 }, { cores: 4 }])(
    'uses low detail from a conservative hint %j',
    (hints) => {
      const policy = createVisitorRenderQuality(hints);
      expect(policy.read()).toEqual({ setting: 'auto', level: 'low', reason: 'device-hint' });
      expect(policy.profile(2.75)).toEqual({ pixelRatio: 1, shadows: false });
    },
  );
  it('caps full detail at DPR 2, retaining fractional ratios and valid lower ratios', () => {
    const policy = createVisitorRenderQuality();
    expect(policy.profile(2.75)).toEqual({ pixelRatio: 2, shadows: true });
    expect(policy.profile(1.5).pixelRatio).toBe(1.5);
    expect(policy.profile(0.8).pixelRatio).toBe(0.8);
    for (const ratio of [0, -1, NaN, Infinity]) expect(policy.profile(ratio).pixelRatio).toBe(1);
  });
  it('lowers detail after sustained slow consecutive draws and never oscillates', () => {
    const policy = createVisitorRenderQuality();
    for (let i = 0; i < 35; i++) expect(policy.observeFrame(50, true)).toBe(false);
    expect(policy.observeFrame(50, true)).toBe(true);
    expect(policy.read()).toEqual({ setting: 'auto', level: 'low', reason: 'slow-frames' });
    for (let i = 0; i < 200; i++) expect(policy.observeFrame(16, true)).toBe(false);
    expect(policy.read().level).toBe('low');
  });
  it('requires enough frames as well as enough time', () => {
    const policy = createVisitorRenderQuality();
    for (let i = 0; i < 19; i++) expect(policy.observeFrame(100, true)).toBe(false);
    expect(policy.observeFrame(100, true)).toBe(true);
  });
  it('allows a deliberate Auto re-check after a downshift, with a fresh window', () => {
    const policy = createVisitorRenderQuality();
    for (let i = 0; i < 36; i++) policy.observeFrame(50, true);
    expect(policy.read().level).toBe('low');
    expect(policy.setSetting('auto')).toBe(true);
    expect(policy.read()).toEqual({ setting: 'auto', level: 'full', reason: 'default' });
    for (let i = 0; i < 30; i++) expect(policy.observeFrame(50, true)).toBe(false);
  });
  it('ignores an expensive first draw, idle map time and hidden-tab gaps', () => {
    const policy = createVisitorRenderQuality();
    expect(policy.observeFrame(180, false)).toBe(false);
    for (let i = 0; i < 500; i++) expect(policy.observeFrame(50, false)).toBe(false);
    for (let i = 0; i < 500; i++) expect(policy.observeFrame(1000, true)).toBe(false);
    expect(policy.read().level).toBe('full');
  });
  it('does not lower detail for occasional slow frames', () => {
    const policy = createVisitorRenderQuality();
    for (let i = 0; i < 1000; i++)
      expect(policy.observeFrame(i % 5 === 0 ? 100 : 16, true)).toBe(false);
    expect(policy.read().level).toBe('full');
  });
  it.each([NaN, -1, 3, 251])(
    'breaks the observation window on invalid/gap duration %s',
    (duration) => {
      const policy = createVisitorRenderQuality();
      for (let i = 0; i < 30; i++) policy.observeFrame(50, true);
      expect(policy.observeFrame(duration, true)).toBe(false);
      for (let i = 0; i < 30; i++) expect(policy.observeFrame(50, true)).toBe(false);
    },
  );
  it('manual full wins over device hints and slow-frame feedback; Auto uses hints again', () => {
    const policy = createVisitorRenderQuality({ cores: 4 });
    expect(policy.setSetting('full')).toBe(true);
    for (let i = 0; i < 100; i++) expect(policy.observeFrame(50, true)).toBe(false);
    expect(policy.read()).toEqual({ setting: 'full', level: 'full', reason: 'manual' });
    expect(policy.setSetting('full')).toBe(false);
    policy.setSetting('auto');
    expect(policy.read()).toEqual({ setting: 'auto', level: 'low', reason: 'device-hint' });
  });
  it('manual low and auto reset do not reuse accumulated slow frames', () => {
    const policy = createVisitorRenderQuality();
    for (let i = 0; i < 30; i++) policy.observeFrame(50, true);
    policy.setSetting('low');
    expect(policy.profile(2).shadows).toBe(false);
    policy.setSetting('auto');
    for (let i = 0; i < 30; i++) expect(policy.observeFrame(50, true)).toBe(false);
  });
  it('restores a settled auto-downshift through map/camera remounts without sharing mutable state', () => {
    const prior = { setting: 'auto', level: 'low', reason: 'slow-frames' } as const;
    const policy = createVisitorRenderQuality({}, prior);
    expect(policy.read()).toEqual(prior);
    const read = policy.read();
    read.level = 'full';
    expect(policy.read().level).toBe('low');
    policy.setSetting('full');
    expect(prior.level).toBe('low');
  });
});
