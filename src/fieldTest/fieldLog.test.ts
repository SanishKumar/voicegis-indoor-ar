/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearFieldLog,
  fieldEvents,
  fieldTestEnabled,
  logField,
  resetFieldTest,
  subscribeFieldLog,
} from './fieldLog';
import { formatFieldReport, type HandsetFacts } from './fieldReport';

afterEach(() => {
  resetFieldTest(null);
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('the field test record', () => {
  it('records nothing unless the app was opened for a field test', () => {
    expect(fieldTestEnabled()).toBe(false);
    logField('ar', { event: 'start' });
    expect(fieldEvents()).toEqual([]);
  });

  it('is switched on from the address and stays on for the tab', () => {
    window.history.replaceState(null, '', '/?fieldtest=1#/visitor');
    expect(fieldTestEnabled()).toBe(true);
    // The app rewrites the address; a reload of the tab still records.
    window.history.replaceState(null, '', '/#/visitor');
    resetFieldTest(null);
    expect(fieldTestEnabled()).toBe(true);
    window.history.replaceState(null, '', '/?fieldtest=0');
    resetFieldTest(null);
    expect(fieldTestEnabled()).toBe(false);
  });

  it('records one change once, however many times it is reported at that moment', () => {
    resetFieldTest(true);
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    logField('orientation', { state: 'listening' });
    logField('camera-view', { facing: 'off' });
    // A development build runs each effect twice.
    logField('orientation', { state: 'listening' });
    logField('orientation', { state: 'stale' });
    now += 2_000;
    // Seconds later the same entry is a report of its own.
    logField('orientation', { state: 'stale' });
    expect(
      fieldEvents().map(({ kind, detail }) => `${kind}:${String(Object.values(detail)[0])}`),
    ).toEqual([
      'orientation:listening',
      'camera-view:off',
      'orientation:stale',
      'orientation:stale',
    ]);
  });

  it('keeps a return to an earlier state even within the duplicate window', () => {
    resetFieldTest(true);
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    logField('orientation', { state: 'listening' });
    now += 20;
    logField('orientation', { state: 'stale' });
    // An unrelated entry must not hide the most recent state for this source.
    logField('camera-view', { facing: 'off' });
    now += 20;
    logField('orientation', { state: 'listening' });
    expect(
      fieldEvents()
        .filter(({ kind }) => kind === 'orientation')
        .map(({ detail }) => detail.state),
    ).toEqual(['listening', 'stale', 'listening']);
  });

  it('keeps the most recent events of a long walk, and tells a listener', () => {
    resetFieldTest(true);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 1_000));
    const listener = vi.fn();
    const unsubscribe = subscribeFieldLog(listener);
    for (let index = 0; index < 520; index += 1) logField('position', { index });
    expect(fieldEvents()).toHaveLength(500);
    expect(fieldEvents()[0].detail.index).toBe(20);
    expect(listener).toHaveBeenCalledTimes(520);
    unsubscribe();
    clearFieldLog();
    expect(fieldEvents()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(520);
  });
});

describe('the field test report', () => {
  const facts: HandsetFacts = {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/128',
    screen: '412×915 @2.63',
    secureContext: true,
    immersiveAr: 'yes',
    orientation: 'absolute',
    orientationAsks: false,
    motion: true,
    motionAsks: false,
    camera: true,
    voices: 12,
    offlineWorker: true,
  };

  it('says which phone and build, then one line per event from the first', () => {
    const report = formatFieldReport({
      facts,
      build: 'c315b67',
      venue: 'asterion-medical-center 9a9c9d37907c',
      events: [
        { atMs: 1_000, kind: 'ar', detail: { event: 'start' } },
        {
          atMs: 3_250,
          kind: 'ar-state',
          detail: { state: 'placed', floorHits: 4, floorY: -0.1234, seconds: 2.25 },
        },
      ],
    });
    expect(report.split('\n')).toEqual([
      'VoiceGIS field test',
      'build c315b67 · venue asterion-medical-center 9a9c9d37907c',
      'phone Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/128',
      'screen 412×915 @2.63 · secure yes · offline worker yes',
      'immersive-ar yes · orientation absolute · motion yes · camera yes · voices 12',
      '2 events',
      '',
      '+    0.0s ar event=start',
      '+    2.3s ar-state state=placed floorHits=4 floorY=-0.12 seconds=2.25',
    ]);
  });

  it('notes where the phone asks before it gives orientation or motion', () => {
    const report = formatFieldReport({
      facts: { ...facts, orientationAsks: true, motionAsks: true, voices: null },
      build: 'x',
      venue: 'v',
      events: [],
    });
    expect(report).toContain('orientation absolute (asks) · motion yes (asks)');
    expect(report).toContain('voices none');
  });
});
