import type { FieldEvent } from './fieldLog';

/** What this phone and browser offer the guidance, as far as a page can ask. */
export interface HandsetFacts {
  userAgent: string;
  screen: string;
  secureContext: boolean;
  /** Whether the browser will run an immersive AR session; 'no-webxr' where it has no WebXR at all. */
  immersiveAr: 'yes' | 'no' | 'no-webxr';
  /** Which orientation events exist: absolute (compass-referenced) as well as relative, or neither. */
  orientation: 'absolute' | 'relative' | 'none';
  orientationAsks: boolean;
  motion: boolean;
  motionAsks: boolean;
  camera: boolean;
  /** Voices the speech engine offers now; they can load late, so zero is not always final. */
  voices: number | null;
  offlineWorker: boolean;
}

export async function probeHandset(): Promise<HandsetFacts> {
  const orientationEvent = (
    window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }
  ).DeviceOrientationEvent;
  const motionEvent = (window as unknown as { DeviceMotionEvent?: { requestPermission?: unknown } })
    .DeviceMotionEvent;
  let immersiveAr: HandsetFacts['immersiveAr'] = 'no-webxr';
  const xr = (
    navigator as unknown as { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } }
  ).xr;
  if (xr && typeof xr.isSessionSupported === 'function') {
    try {
      immersiveAr = (await xr.isSessionSupported('immersive-ar')) ? 'yes' : 'no';
    } catch {
      immersiveAr = 'no';
    }
  }
  return {
    userAgent: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight} @${Number(window.devicePixelRatio || 1).toFixed(2)}`,
    secureContext: window.isSecureContext === true,
    immersiveAr,
    orientation:
      'ondeviceorientationabsolute' in window
        ? 'absolute'
        : orientationEvent !== undefined
          ? 'relative'
          : 'none',
    orientationAsks: typeof orientationEvent?.requestPermission === 'function',
    motion: motionEvent !== undefined,
    motionAsks: typeof motionEvent?.requestPermission === 'function',
    camera: typeof navigator.mediaDevices?.getUserMedia === 'function',
    voices: typeof speechSynthesis === 'undefined' ? null : speechSynthesis.getVoices().length,
    offlineWorker: Boolean(navigator.serviceWorker?.controller),
  };
}

function value(detail: FieldEvent['detail'][string]) {
  if (typeof detail === 'number') {
    return Number.isInteger(detail) ? String(detail) : detail.toFixed(2);
  }
  return String(detail);
}

const yes = (flag: boolean) => (flag ? 'yes' : 'no');

/**
 * Plain text a tester can paste into a message: who, what, and then one line
 * per event with the seconds since the first.
 */
export function formatFieldReport(input: {
  facts: HandsetFacts;
  events: readonly FieldEvent[];
  build: string;
  venue: string;
}): string {
  const { facts, events } = input;
  const first = events[0]?.atMs ?? 0;
  const lines = [
    'VoiceGIS field test',
    `build ${input.build} · venue ${input.venue}`,
    `phone ${facts.userAgent}`,
    `screen ${facts.screen} · secure ${yes(facts.secureContext)} · offline worker ${yes(facts.offlineWorker)}`,
    `immersive-ar ${facts.immersiveAr} · orientation ${facts.orientation}${facts.orientationAsks ? ' (asks)' : ''} · motion ${yes(facts.motion)}${facts.motionAsks ? ' (asks)' : ''} · camera ${yes(facts.camera)} · voices ${facts.voices ?? 'none'}`,
    `${events.length} events`,
    '',
    ...events.map((event) => {
      const seconds = ((event.atMs - first) / 1000).toFixed(1).padStart(7);
      const detail = Object.entries(event.detail)
        .map(([key, entry]) => `${key}=${value(entry)}`)
        .join(' ');
      return `+${seconds}s ${event.kind}${detail ? ` ${detail}` : ''}`;
    }),
  ];
  return lines.join('\n');
}
