import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Download, Square } from 'lucide-react';
import {
  SessionRecorder,
  exportCaptureSession,
  validateCaptureSession,
  type CaptureIssue,
  type CaptureSession,
  type CheckpointAnchor,
} from '@voicegis/localization-core';
import {
  HANDSET_SENSOR_PROFILE,
  HandsetCaptureAdapter,
  requestMotionPermission,
  type MotionEventLike,
  type MotionPermission,
  type OrientationEventLike,
} from '../capture/handsetCapture';
import { RATE_WINDOW_MS, liveness, type LiveStats, type Liveness } from '../capture/liveness';
import { useVenue } from '../context/VenueContext.jsx';

/**
 * Recording a walk from the handset this page is open on.
 *
 * The point of this surface is not a demo. Two numbers cannot be obtained any
 * other way — how far behind an inertial sample its tilt arrives, and how often
 * the platform delivers a half-populated sample — and the decision about
 * whether a browser walk can ever be evidence rests on the first of them. So
 * the lag is shown while recording rather than buried in the exported file.
 *
 * Nothing recorded here is evidence, and the page says so rather than leaving
 * it to be inferred. A capture from `devicemotion` declares the device frame,
 * which the evidence policy refuses outright; what it produces is a real
 * measurement of the sensors, which is what the policy decision needs.
 */

type Phase = 'idle' | 'recording' | 'stopped';

/**
 * What this surface needs from the venue context, which is untyped JavaScript.
 *
 * Declared narrowly and asserted once, at the single point where the untyped
 * boundary is crossed, rather than spreading `any` through the component. The
 * anchors a compiled package ships carry fields the capture schema does not
 * define; `SessionRecorder` snapshots them and drops the extras, so handing
 * them straight over is deliberate rather than sloppy.
 */
interface RecordingVenue {
  buildingPackage: {
    building: { id: string };
    manifest: { contentHash: string };
    localizationAnchors: CheckpointAnchor[];
  };
}

const ACCESS_NOTE: Record<MotionPermission, string> = {
  granted: 'Motion access granted.',
  denied: 'Motion access was refused. iOS only grants it over HTTPS, and only from a direct tap.',
  'not-required':
    'This browser hands over motion sensors without asking, so there was no prompt. That is not the same as having any.',
  unsupported: 'This browser exposes no motion sensors at all.',
};

interface Finished {
  session: CaptureSession;
  issues: CaptureIssue[];
  sessionId: string;
}

/** Sensors deliver at tens of hertz; React is polled, never driven per event. */
const STATS_POLL_MS = 250;

function formatMs(value: number | null) {
  return value === null ? '—' : `${Math.round(value)} ms`;
}

function motionEventConstructor() {
  return (globalThis as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } })
    .DeviceMotionEvent;
}

export default function WalkRecorder() {
  const { venue } = useVenue() as { venue: RecordingVenue | null };
  const [phase, setPhase] = useState<Phase>('idle');
  const [access, setAccess] = useState<MotionPermission | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [windowedHz, setWindowedHz] = useState<number | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const rateMarksRef = useRef<Array<{ atMs: number; samples: number }>>([]);

  const recorderRef = useRef<SessionRecorder | null>(null);
  const adapterRef = useRef<HandsetCaptureAdapter | null>(null);
  const originRef = useRef<number>(0);
  const sessionIdRef = useRef<string>('');
  const detachRef = useRef<(() => void) | null>(null);

  // Detaching on unmount matters more than usual here: a listener left behind
  // keeps feeding a recorder nobody is watching, and on a phone that is a
  // sensor subscription that never stops draining the battery.
  useEffect(() => () => detachRef.current?.(), []);

  const readStats = useCallback(() => {
    const adapter = adapterRef.current;
    const recorder = recorderRef.current;
    if (!adapter || !recorder) return;

    const now = performance.now();
    const marks = rateMarksRef.current;
    marks.push({ atMs: now, samples: adapter.recordedSamples });
    while (marks.length > 1 && now - marks[0].atMs > RATE_WINDOW_MS) marks.shift();
    const span = marks.length > 1 ? (now - marks[0].atMs) / 1000 : 0;
    setWindowedHz(span > 0 ? (adapter.recordedSamples - marks[0].samples) / span : null);

    setStats({
      elapsedMs: performance.now() - originRef.current,
      eventCount: recorder.eventCount,
      recordedSamples: adapter.recordedSamples,
      pairing: adapter.pairing,
      rejections: adapter.rejections,
    });
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const timer = window.setInterval(readStats, STATS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [phase, readStats]);

  const start = useCallback(async () => {
    // Must stay inside the click: iOS only honours the request during a real
    // user gesture, and an await before it would already be too late.
    const granted = await requestMotionPermission(motionEventConstructor());
    setAccess(granted);
    if (granted === 'denied' || granted === 'unsupported') return;

    const buildingPackage = venue?.buildingPackage;
    if (!buildingPackage) return;
    const sessionId = `walk-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const origin = performance.now();

    const recorder = new SessionRecorder({
      sessionId,
      buildingId: buildingPackage.building.id,
      packageHash: buildingPackage.manifest.contentHash,
      device: {
        label: navigator.userAgent.slice(0, 120),
        platform: 'web',
        sensors: { ...HANDSET_SENSOR_PROFILE },
      },
      // Straight from the compiled package, so the walk is bound to the
      // anchors this venue actually shipped.
      anchors: buildingPackage.localizationAnchors,
      startedAtIso: new Date().toISOString(),
    });
    const adapter = new HandsetCaptureAdapter(recorder, { originTimeStampMs: origin });

    const onMotion = (event: Event) => adapter.handleMotion(event as unknown as MotionEventLike);
    const onOrientation = (event: Event) =>
      adapter.handleOrientation(event as unknown as OrientationEventLike);
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);

    detachRef.current = () => {
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('deviceorientation', onOrientation);
      detachRef.current = null;
    };

    recorderRef.current = recorder;
    adapterRef.current = adapter;
    originRef.current = origin;
    sessionIdRef.current = sessionId;
    setFinished(null);
    setStats(null);
    setWindowedHz(null);
    rateMarksRef.current = [];
    setPhase('recording');
  }, [venue]);

  const stop = useCallback(() => {
    detachRef.current?.();
    const recorder = recorderRef.current;
    if (!recorder) return;

    // Same clock the samples were stamped from, so the terminal event cannot
    // land before the last sample it closes.
    recorder.recordLifecycle('session-end', performance.now() - originRef.current);
    const session = recorder.buildSession();
    readStats();
    setFinished({ session, issues: validateCaptureSession(session), sessionId: sessionIdRef.current });
    setPhase('stopped');
  }, [readStats]);

  const download = useCallback(() => {
    if (!finished || finished.issues.length > 0) return;
    // Export refuses an invalid session by design, so this path is only ever
    // reached with a capture the schema already accepted.
    const blob = new Blob([exportCaptureSession(finished.session)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${finished.sessionId}.capture.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [finished]);

  if (!venue) return null;

  return (
    <main className="walk-recorder" id="main-content">
      <header className="walk-recorder-head">
        <h1>Record a walk</h1>
        <p className="walk-recorder-venue">
          {venue.buildingPackage.building.id} ·{' '}
          <code>{venue.buildingPackage.manifest.contentHash.slice(0, 12)}</code>
        </p>
      </header>

      <p className="walk-recorder-warning" role="note">
        <strong>This is not evidence.</strong> A browser reports inertial samples in the device
        frame, which the evidence policy refuses outright, so every capture recorded here seals as{' '}
        <code>unsupported-sensor-model</code>. What it does produce is a real measurement of how far
        behind each sample its orientation arrives — the number the policy decision is waiting on.
      </p>

      {access && (
        <p
          className={
            access === 'granted' || access === 'not-required'
              ? 'walk-recorder-access'
              : 'walk-recorder-error'
          }
          role={access === 'denied' || access === 'unsupported' ? 'alert' : undefined}
        >
          {ACCESS_NOTE[access]}
        </p>
      )}

      <div className="walk-recorder-controls">
        {phase === 'recording' ? (
          <button type="button" className="walk-recorder-stop" onClick={stop}>
            <Square size={16} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button type="button" className="walk-recorder-start" onClick={() => void start()}>
            <Circle size={16} aria-hidden="true" /> {phase === 'stopped' ? 'Record again' : 'Start'}
          </button>
        )}
      </div>

      {stats && phase === 'recording' && <LivenessBanner status={liveness(stats, windowedHz)} />}

      {stats && (
        <section className="walk-recorder-stats" aria-live="polite">
          <Stat label="Elapsed" value={`${(stats.elapsedMs / 1000).toFixed(1)} s`} />
          <Stat label="Samples recorded" value={String(stats.recordedSamples)} />
          <Stat label="Paired with tilt" value={String(stats.pairing.pairedCount)} />
          <Stat label="Tilt lag, median" value={formatMs(stats.pairing.medianStalenessMs)} />
          <Stat label="Tilt lag, p95" value={formatMs(stats.pairing.p95StalenessMs)} />
          <Stat label="Tilt lag, worst" value={formatMs(stats.pairing.worstStalenessMs)} />
          <Stat label="No tilt yet" value={String(stats.pairing.unpairedCount)} />
          <Stat label="Incomplete" value={String(stats.rejections.incomplete)} />
          <Stat label="Clock went back" value={String(stats.rejections.regressed)} />
        </section>
      )}

      {finished && (
        <section className="walk-recorder-result">
          {finished.issues.length === 0 ? (
            <>
              <p>
                Capture is valid: {finished.session.events.length} events. Seal it with{' '}
                <code>npm run evidence -- seal</code> once you have a checkpoint manifest for it.
              </p>
              <button type="button" className="walk-recorder-download" onClick={download}>
                <Download size={16} aria-hidden="true" /> Download capture
              </button>
            </>
          ) : (
            <>
              <p className="walk-recorder-error" role="alert">
                The capture did not validate, so it cannot be exported. Serialising an invalid
                stream is refused by the library rather than worked around here.
              </p>
              <ul className="walk-recorder-issues">
                {finished.issues.slice(0, 10).map((issue) => (
                  <li key={`${issue.code}${issue.path}`}>
                    <code>{issue.code}</code> at <code>{issue.path}</code> — {issue.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}

function LivenessBanner({ status }: { status: Liveness }) {
  if (status.kind === 'receiving') {
    return (
      <p className="walk-recorder-live walk-recorder-live-ok" role="status">
        <span className="walk-recorder-pulse" aria-hidden="true" />
        Receiving {status.hz.toFixed(0)} samples/sec.
      </p>
    );
  }

  if (status.kind === 'stalled') {
    return (
      <p className="walk-recorder-live walk-recorder-live-bad" role="alert">
        <strong>Delivery has stopped.</strong> Samples were arriving and no longer are. A phone that
        locks, sleeps, or backgrounds the browser stops reporting motion; bring this page back to
        the foreground.
      </p>
    );
  }

  if (status.kind === 'sensorless') {
    return (
      <p className="walk-recorder-live walk-recorder-live-bad" role="alert">
        <strong>Nothing is being recorded.</strong> This browser is firing motion events with every
        field empty, which is what a device with no motion sensors does — a desktop or a laptop.
        Open this page on a phone.
      </p>
    );
  }

  return (
    <p className="walk-recorder-live walk-recorder-live-bad" role="alert">
      <strong>Nothing is being recorded.</strong> No motion events have arrived at all. On a desktop
      browser none ever will; open this page on a phone.
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="walk-recorder-stat">
      <span className="walk-recorder-stat-label">{label}</span>
      <span className="walk-recorder-stat-value">{value}</span>
    </div>
  );
}
