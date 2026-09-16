import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LiveLocalizationSession,
  watchLocalizationSession,
  type LiveSessionSnapshot,
} from '@voicegis/localization-core';
import { useNavigation } from '../context/NavigationContext.jsx';
import {
  prepareDiagnosticSession,
  type DiagnosticSessionRequest,
} from '../navigation/prepareDiagnosticSession';
import type { CompiledBuildingRuntime } from '../data/compiledBuilding';
import type { ExplainedRouteResult } from '../engine/compiledRoutePolicy';
import type { OperationalOverlay } from '../engine/operationalOverlay';
import { LiveHandsetInput, type HandsetInputSnapshot } from '../capture/liveHandsetInput';
import { startHandsetSubscription, type HandsetAccessState } from '../capture/handsetSubscription';
import './sessionHarness.css';

interface HarnessNavigation {
  venue: CompiledBuildingRuntime;
  state: { route: ExplainedRouteResult | null };
  accessibleRouting: boolean;
  operationalOverlay: OperationalOverlay | null;
  operationalEvaluatedAt: string | null;
}

/** Operator-only, with no navigation actions or hardware capability passed in. */
export default function SessionHarness() {
  const { venue, state, accessibleRouting, operationalOverlay, operationalEvaluatedAt } =
    useNavigation() as unknown as HarnessNavigation;
  if (!state.route?.found)
    return (
      <section className="session-harness" aria-label="Checkpoint session diagnostic">
        <h2>Checkpoint session diagnostic</h2>
        <p>Plan a route in Visitor view, then return here to inspect its session boundary.</p>
        <p>No camera or motion sensors are accessed by this diagnostic.</p>
      </section>
    );
  const request = {
    buildingPackage: venue.buildingPackage,
    route: state.route,
    policy: {
      profile: accessibleRouting ? ('wheelchair' as const) : ('standard' as const),
      ...(operationalOverlay
        ? { operationalOverlay, evaluatedAt: operationalEvaluatedAt ?? '' }
        : {}),
    },
  };
  // A changed journey/policy owns a new component: cleanup retires pending hash
  // checks and running sessions. Browsing an instruction/floor does not change it.
  const key = JSON.stringify([venue.key, state.route.pathIds, state.route.receipt, request.policy]);
  return <RouteSessionHarness key={key} request={request} />;
}

const REASONS: Record<LiveSessionSnapshot['reason'], string> = {
  'not-started': 'Not started',
  'checkpoint-required': 'Waiting for a checkpoint test',
  'awaiting-heading': 'Checkpoint resolved · independent heading unavailable',
  'awaiting-motion': 'Waiting for qualified motion',
  tracking: 'Tracking',
  degraded: 'Caution',
  'stale-motion': 'Expired · no qualified motion received',
  'heading-unavailable': 'Heading unavailable',
  'quality-lost': 'Location quality lost',
  'route-rejected': 'Route match refused',
  'invalid-input': 'Input refused',
  'clock-invalid': 'Clock invalid',
  stopped: 'Stopped',
  hidden: 'Paused · page hidden',
  'permission-denied': 'Permission denied',
  'sensor-unavailable': 'Sensors unavailable',
  'floor-change': 'Floor change needs confirmation',
};

type Phase = 'idle' | 'preparing' | 'ready' | 'paused' | 'stopped';
type Request = Omit<DiagnosticSessionRequest, 'sessionId' | 'routeRevision'>;
type InputState = HandsetAccessState | 'off' | 'stopped';
const INPUT_LABELS: Record<InputState, string> = {
  off: 'Off · no sensor listeners',
  stopped: 'Stopped · no sensor listeners',
  requesting: 'Waiting for motion and orientation permission…',
  listening: 'Listening · sensor delivery is not tracking',
  denied: 'Sensor access denied · enable explicitly to retry',
  unsupported: 'Motion or orientation is unavailable in this browser',
  insecure: 'Motion access requires a secure connection (HTTPS)',
  hidden: 'Paused · enable explicitly after restarting the diagnostic',
  error: 'Input stopped after an error · restart the diagnostic',
};
interface SessionOwner {
  session: LiveLocalizationSession;
  dispose: () => void;
  input: LiveHandsetInput | null;
  detachInput: (() => void) | null;
}

function detachInput(owner: SessionOwner) {
  owner.detachInput?.();
  owner.detachInput = null;
  owner.input?.dispose();
  owner.input = null;
}

export function RouteSessionHarness({ request }: { request: Request }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot | null>(null);
  const [payload, setPayload] = useState('');
  const [notice, setNotice] = useState('');
  const [inputState, setInputState] = useState<InputState>('off');
  const [inputStats, setInputStats] = useState<HandsetInputSnapshot | null>(null);
  const ownerRef = useRef<SessionOwner | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);

  const retire = useCallback(() => {
    generationRef.current += 1;
    const owner = ownerRef.current;
    ownerRef.current = null;
    if (owner) {
      detachInput(owner);
      owner.dispose();
      return owner.session.stop(performance.now());
    }
    return null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const pause = () => {
      generationRef.current += 1;
      const owner = ownerRef.current;
      if (owner) {
        detachInput(owner);
        setInputState('hidden');
        owner.dispose();
        setSnapshot(owner.session.interrupt('hidden', performance.now()));
      }
      setPhase((current) => (current === 'idle' || current === 'stopped' ? current : 'paused'));
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    return () => {
      mountedRef.current = false;
      retire();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pause);
    };
  }, [retire]);

  const start = async () => {
    if (document.hidden) return;
    retire();
    const generation = generationRef.current;
    setSnapshot(null);
    setNotice('');
    setInputState('off');
    setInputStats(null);
    setPhase('preparing');
    try {
      const options = await prepareDiagnosticSession({
        ...request,
        sessionId: `diagnostic-${crypto.randomUUID()}`,
        routeRevision: generation,
      });
      if (!mountedRef.current || generationRef.current !== generation || document.hidden) return;
      const session = new LiveLocalizationSession(options);
      session.beginAcquisition(performance.now());
      const owner: SessionOwner = { session, dispose: () => {}, input: null, detachInput: null };
      ownerRef.current = owner;
      owner.dispose = watchLocalizationSession(session, {
        now: () => performance.now(),
        onSnapshot: (current) => {
          if (ownerRef.current !== owner) return;
          if (owner.input) setInputStats(owner.input.read(current.nowMs));
          // Input freshness may freeze the session during this same publication.
          setSnapshot(session.read(current.nowMs));
        },
      });
      setPhase('ready');
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      retire();
      setPhase('stopped');
      setNotice(error instanceof Error ? error.message : 'Session preparation failed.');
    }
  };

  const checkpoint = (event: React.FormEvent) => {
    event.preventDefault();
    const owner = ownerRef.current;
    if (!owner || phase !== 'ready' || document.hidden || inputState === 'requesting') return;
    const { session } = owner;
    const now = performance.now();
    owner.input?.dispose();
    const lease = session.beginAcquisition(now);
    // Raw callbacks are synchronous and occurrence-gated. No pending permission
    // may cross this boundary; the replacement starts with no tilt or peak.
    owner.input = inputState === 'listening' ? new LiveHandsetInput(session, lease, now) : null;
    setInputStats(null);
    const result = session.reacquire(
      lease,
      { kind: 'qr', payload: payload.trim(), timeMs: now },
      now,
    );
    setSnapshot(result.snapshot);
    setNotice(
      result.accepted
        ? 'Authored checkpoint resolved for this diagnostic only. This was not a physical scan.'
        : `Checkpoint refused: ${result.reason}.`,
    );
  };

  const enableInput = () => {
    const owner = ownerRef.current;
    if (!owner || phase !== 'ready' || document.hidden || owner.detachInput) return;
    const now = performance.now();
    const lease = owner.session.beginAcquisition(now);
    owner.input = new LiveHandsetInput(owner.session, lease, now);
    setSnapshot(owner.session.read(now));
    setInputStats(null);
    setNotice(
      'After sensor access is ready, test a checkpoint again. Calibration remains unavailable.',
    );
    let continuing = true;
    const dispose = startHandsetSubscription({
      onMotion: (event, at) => {
        if (ownerRef.current === owner) owner.input?.motion(event, at);
      },
      onOrientation: (event, at) => {
        if (ownerRef.current === owner) owner.input?.orientation(event, at);
      },
      onState: (state) => {
        if (ownerRef.current !== owner) return;
        setInputState(state);
        if (state === 'requesting' || state === 'listening') return;
        continuing = false;
        detachInput(owner);
        setSnapshot(
          owner.session.interrupt(
            state === 'denied'
              ? 'permission-denied'
              : state === 'hidden'
                ? 'hidden'
                : 'sensor-unavailable',
            performance.now(),
          ),
        );
      },
    });
    if (continuing) owner.detachInput = dispose;
    else dispose();
  };

  return (
    <section className="session-harness" aria-label="Checkpoint session diagnostic">
      <div className="session-harness-heading">
        <div>
          <span>Operator diagnostic</span>
          <h2>Checkpoint session</h2>
        </div>
        <strong className="session-harness-gate">Guidance frozen</strong>
      </div>
      <p>
        Exercise the verified package, route and recovery boundary without moving the Visitor
        journey.
      </p>
      <p className="session-harness-note">
        Manual checkpoint tests are not measured scans or accuracy evidence. Independent travel
        calibration is unavailable here; motion access alone cannot enable guidance. No camera is
        accessed. Sensor diagnostics require a separate, explicit opt-in below.
      </p>
      <dl className="session-harness-facts">
        <div>
          <dt>Package</dt>
          <dd>
            <code>{request.buildingPackage.manifest.contentHash.slice(0, 12)}</code>
          </dd>
        </div>
        <div>
          <dt>Route profile</dt>
          <dd>{request.policy.profile === 'wheelchair' ? 'Step-free' : 'Standard'}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>
            {phase === 'stopped'
              ? 'Stopped'
              : phase === 'preparing'
                ? 'Verifying package and policy…'
                : snapshot
                  ? REASONS[snapshot.reason]
                  : phase === 'paused'
                    ? 'Paused · start explicitly to resume'
                    : 'Not started'}
          </dd>
        </div>
        <div>
          <dt>Last checkpoint test</dt>
          <dd>{snapshot?.checkpointAnchorId ?? 'None'}</dd>
        </div>
      </dl>
      <div className="session-harness-actions">
        <button type="button" disabled={phase === 'preparing'} onClick={() => void start()}>
          Start checkpoint diagnostic
        </button>
        <button
          type="button"
          disabled={phase === 'idle' || phase === 'stopped'}
          onClick={() => {
            setSnapshot(retire());
            setPhase('stopped');
            setInputState('stopped');
            setNotice('Diagnostic stopped.');
          }}
        >
          Stop diagnostic
        </button>
      </div>
      <form onSubmit={checkpoint}>
        <label htmlFor="diagnostic-checkpoint">Checkpoint payload (manual test)</label>
        <input
          id="diagnostic-checkpoint"
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          placeholder="voicegis://…"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={phase !== 'ready' || inputState === 'requesting' || !payload.trim()}
        >
          Test checkpoint / reacquire
        </button>
      </form>
      <p role="status" className="session-harness-notice">
        {notice}
      </p>
      <div className="session-harness-input" role="group" aria-label="Handset input diagnostics">
        <h3>Motion input</h3>
        <p>
          Opt in to read motion and tilt on this device. These diagnostics stay in memory; they do
          not record, export, request a camera, or move your Visitor route.
        </p>
        <p className="session-harness-input-state" aria-live="polite">
          {INPUT_LABELS[inputState]}
        </p>
        <div className="session-harness-actions">
          <button
            type="button"
            disabled={
              phase !== 'ready' || inputState === 'requesting' || inputState === 'listening'
            }
            onClick={enableInput}
          >
            Enable motion diagnostics
          </button>
          <button
            type="button"
            disabled={inputState !== 'requesting' && inputState !== 'listening'}
            onClick={() => {
              const owner = ownerRef.current;
              if (!owner) return;
              detachInput(owner);
              setInputState('stopped');
              setSnapshot(owner.session.interrupt('sensor-unavailable', performance.now()));
            }}
          >
            Disable motion diagnostics
          </button>
        </div>
        <dl className="session-harness-facts">
          <div>
            <dt>Complete paired samples</dt>
            <dd>{inputStats?.completeSamples ?? 0}</dd>
          </div>
          <div>
            <dt>Rejected input</dt>
            <dd>{inputStats?.rejectedSamples ?? 0}</dd>
          </div>
          <div>
            <dt>Last paired sample</dt>
            <dd>
              {inputStats?.sampleAgeMs == null
                ? 'None received'
                : inputState === 'listening'
                  ? `${Math.round(inputStats.sampleAgeMs)} ms ago`
                  : 'From stopped input'}
            </dd>
          </div>
          <div>
            <dt>Travel calibration</dt>
            <dd>Unavailable · guidance stays frozen</dd>
          </div>
        </dl>
        {inputStats?.problem && (
          <p className="session-harness-note">
            {inputStats.problem}. Fresh data cannot restore guidance; explicit checkpoint recovery
            is required.
          </p>
        )}
        <p>
          Enable first, then test a checkpoint. Each checkpoint clears old tilt and unfinished
          motion. Freshness limits are experimental software checks, not measured device accuracy.
        </p>
      </div>
    </section>
  );
}
