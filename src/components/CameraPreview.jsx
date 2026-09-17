/**
 * The camera as a window onto the same guidance as the map.
 *
 * The route ahead is drawn on the floor of the camera image from where the
 * visitor is along the route and which way the phone faces. Progress is the
 * same progress the map's marker uses - from live tracking or from the
 * walk-through - and the facing comes from the phone's gyroscope once
 * tracking has established the direction of travel, or from the visitor
 * saying they are looking along the corridor. None of that anchors anything
 * to the building, and the view says so in as many words.
 *
 * On a phone that can run an immersive session, the route is anchored to the
 * world instead and the phone's own tracked movement moves the marker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Camera,
  CameraOff,
  Compass,
  Crosshair,
  LocateFixed,
  Map,
  Navigation,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useNavigation, VIEW_TYPE, NAV_STATUS } from '../context/NavigationContext.jsx';
import { bannerCopy } from './journey/guidanceCopy';
import { speechAvailable } from './journey/useSpokenGuidance.js';
import ManeuverIcon from './journey/ManeuverIcon.jsx';
import { ANCHOR_SIGMA } from '../navigation/liveTracker';
import { bearingAt, guidanceAt, positionAt, trackForRoute } from '../navigation/routeProgress';
import { facingFrom } from '../ar/facingFrom';
import { DEFAULT_CAMERA_MODEL, projectRouteAhead } from '../ar/floorProjection';
import { ArStartError, immersiveArSupported, startArGuidance } from '../ar/arSession';

const INK = '#000609';
const CREAM = '#fff9f0';
/** How often the drawn state is written out for the readiness panel and tests. */
const REPORT_MS = 200;
/** The phone held a little below level when nothing says otherwise. */
const RESTING_PITCH_DEGREES = -18;

/**
 * @param {{
 *   tracking?: import('./journey/useLiveTracking.js').LiveTracking | null,
 *   voice?: boolean,
 *   onVoice?: ((on: boolean) => void) | null,
 * }} props
 */
export default function CameraPreview({ tracking = null, voice = false, onVoice = null }) {
  const { state, actions, venue } = useNavigation();
  if (state.activeView !== VIEW_TYPE.CAMERA_PREVIEW) return null;
  return (
    <CameraGuidance
      state={state}
      actions={actions}
      venue={venue}
      tracking={tracking}
      voice={voice}
      onVoice={onVoice}
    />
  );
}

/** Pitch and roll of the rear camera from the gravity the phone reports, in portrait. */
function attitudeFromGravity(gravity) {
  if (!gravity) return { pitch: RESTING_PITCH_DEGREES, roll: 0, known: false };
  const size = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (!(size > 1)) return { pitch: RESTING_PITCH_DEGREES, roll: 0, known: false };
  // The rear camera looks along the phone's minus-z; its height above the
  // horizon is the angle between that and the up the reported gravity gives.
  const pitch = (Math.asin(Math.max(-1, Math.min(1, -gravity.z / size))) * 180) / Math.PI;
  // Roll is the screen's top leaning away from up, clockwise positive.
  const roll = (Math.atan2(-gravity.x, gravity.y) * 180) / Math.PI;
  return {
    pitch: Math.max(-89, Math.min(89, pitch)),
    roll: Math.max(-60, Math.min(60, roll)),
    known: true,
  };
}

function tierLabel(snapshot) {
  if (!snapshot) return 'Starting';
  const sigma = `±${Math.max(1, Math.round(snapshot.sigmaMeters))} m`;
  switch (snapshot.tier) {
    case 'anchored':
      return `At the check-in point · ${sigma}`;
    case 'tracking':
      return `Tracking · ${sigma}`;
    case 'caution':
      return `Caution · ${sigma}`;
    default:
      return snapshot.reason === 'floor-change'
        ? 'Waiting at the floor change'
        : snapshot.reason === 'arrived'
          ? 'At the destination'
          : 'Holding';
  }
}

function headingLabel(source) {
  switch (source) {
    case 'ar':
      return 'World-tracked';
    case 'tracker':
      return 'Gyroscope, aligned by your walk';
    case 'aligned':
      return 'Gyroscope, aligned by you';
    case 'assumed':
      return 'Assumed along route';
    default:
      return 'Off';
  }
}

function CameraGuidance({ state, actions, venue, tracking, voice, onVoice }) {
  const { route, navStatus, progressMeters, locationBasis } = state;
  const navigating = navStatus === NAV_STATUS.NAVIGATING || navStatus === NAV_STATUS.ARRIVED;
  const found = navigating && Boolean(route?.found) && route.steps.length > 0;
  const track = found ? trackForRoute(route) : null;
  const guidance = track ? guidanceAt(track, progressMeters) : null;
  const floorName = (floorId) => venue.getFloorById(floorId)?.name;
  const riding = track ? positionAt(track, progressMeters).vertical : false;
  const copy =
    track && guidance
      ? bannerCopy(route.steps, track, guidance, progressMeters, floorName, riding)
      : null;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const overlayRef = useRef(null);
  const controlsRef = useRef(null);
  const telemetryRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [arSupport, setArSupport] = useState('checking');
  const [arSession, setArSession] = useState(null);
  const [arStarting, setArStarting] = useState(false);
  const [arProblem, setArProblem] = useState(null);
  const [arReport, setArReport] = useState(null);
  /** The visitor said they were looking along the corridor: the gyroscope reading at that moment. */
  const [alignment, setAlignment] = useState(null);
  const [drawn, setDrawn] = useState({ facing: null, points: 0, gravity: false });
  // The loop below draws every frame; it reads progress here rather than restarting for it.
  const progressRef = useRef(progressMeters);
  useEffect(() => {
    progressRef.current = progressMeters;
  });

  const live = tracking?.status === 'on';
  const plausible = Boolean(tracking?.plausible);
  const sensorsOut =
    tracking?.status === 'unsupported' ||
    tracking?.status === 'insecure' ||
    tracking?.status === 'requesting';
  const knownStart = locationBasis !== 'default';
  const canTrack = plausible && !live && !sensorsOut && knownStart && found;
  const trackLabel =
    tracking?.status === 'hidden'
      ? 'Resume tracking'
      : tracking?.status === 'denied' || tracking?.status === 'error'
        ? 'Try tracking again'
        : 'Track my walk';
  const arAvailable = arSupport === 'yes' && found && plausible && !sensorsOut;

  // Controls wrap on phones. The readiness panel keeps clear of their measured height.
  useEffect(() => {
    const controls = controlsRef.current;
    const root = controls?.parentElement;
    if (!controls || !root) return undefined;
    const publish = () =>
      root.style.setProperty(
        '--camera-preview-controls-height',
        `${controls.getBoundingClientRect().height}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(controls);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--camera-preview-controls-height');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    immersiveArSupported().then((supported) => {
      if (!cancelled) setArSupport(supported ? 'yes' : 'no');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!found) return undefined;
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video
              .play()
              .then(() => setVideoReady(true))
              .catch((error) => setCameraError(error.message || 'Camera playback failed'));
          };
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Camera preview failed:', error);
          setCameraError(error instanceof Error ? error.message : 'Camera access denied');
        }
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      streamRef.current = null;
      setVideoReady(false);
    };
  }, [found]);

  // The drawing loop: the route on the floor, from the freshest reading every frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !track || cameraError) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const container = canvas.parentElement;
    let frame = 0;
    let lastReport = 0;
    let lastDrawn = null;
    let fadeFrom = null;

    const fit = () => {
      const bounds = container?.getBoundingClientRect() ?? { width: 0, height: 0 };
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;
    };
    const observer = container ? new ResizeObserver(fit) : null;
    if (container) observer.observe(container);
    fit();

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = width > 0 ? canvas.width / width : 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const reading = tracking?.peek ? tracking.peek() : { gravity: null, snapshot: null };
      const { facing, progress } = facingFrom(
        track,
        live,
        reading.snapshot,
        alignment,
        progressRef.current,
      );
      const attitude = attitudeFromGravity(live ? reading.gravity : null);
      const here = positionAt(track, progress);
      const projection = projectRouteAhead(
        track,
        progress,
        {
          x: here.x,
          y: here.y,
          facingDegrees: facing,
          pitchDegrees: attitude.pitch,
          rollDegrees: attitude.roll,
        },
        { width, height, ...DEFAULT_CAMERA_MODEL },
      );

      // An immersive session draws its own floor; the flat overlay stays out of its way.
      if (!arSession) paintProjection(context, { width, height }, projection, fadeFrom);

      const now = performance.now();
      const points = projection.ribbon.reduce((sum, line) => sum + line.length, 0);
      if (now - lastReport >= REPORT_MS) {
        lastReport = now;
        // The ribbon's near end would run under the readiness panel; it fades out above it.
        const panel = telemetryRef.current;
        fadeFrom = panel
          ? panel.getBoundingClientRect().top - canvas.getBoundingClientRect().top - 16
          : height * 0.72;
        const next = {
          facing: Math.round(facing),
          points,
          gravity: attitude.known,
        };
        if (
          lastDrawn === null ||
          next.facing !== lastDrawn.facing ||
          next.points !== lastDrawn.points ||
          next.gravity !== lastDrawn.gravity
        ) {
          lastDrawn = next;
          setDrawn(next);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [alignment, arSession, cameraError, live, track, tracking]);

  useEffect(() => () => void arSession?.end(), [arSession]);

  const alignNow = useCallback(() => {
    if (!track || !tracking?.peek) return;
    const { snapshot } = tracking.peek();
    if (!snapshot || snapshot.relativeHeadingDegrees === null) return;
    setAlignment({
      epoch: snapshot.headingEpoch,
      relative: snapshot.relativeHeadingDegrees,
      facing: bearingAt(track, snapshot.progressMeters),
    });
  }, [track, tracking]);

  const startAr = useCallback(async () => {
    if (!track || !tracking || !overlayRef.current || arStarting) return;
    setArProblem(null);
    setArStarting(true);
    try {
      // Sensors and the tracker come from the same tap the session needs.
      if (tracking.status !== 'on') tracking.start();
      const tracker = tracking.tracker();
      if (!tracker) throw new ArStartError('failed');
      const now = performance.now();
      const current = tracker.isAnchored ? tracker.read(now).progressMeters : null;
      // The session assumes the visitor stands where the guidance is. A
      // tracker that has not been anchored, or that disagrees with a
      // walk-through the visitor advanced by hand, is anchored there with the
      // uncertainty of a chosen point rather than a scanned one.
      if (current === null || Math.abs(current - progressMeters) > 0.5) {
        tracker.anchor({
          progressMeters,
          sigmaMeters: ANCHOR_SIGMA.selected,
          timeMs: now,
        });
      }
      const handle = await startArGuidance({
        track,
        tracker,
        overlay: overlayRef.current,
        facingDegrees: () => {
          const snapshot = tracker.read(performance.now());
          return snapshot.displacementAttached ? null : snapshot.headingDegrees;
        },
        onFrame: setArReport,
        onEnd: () => {
          setArSession(null);
          setArReport(null);
        },
      });
      setArSession(handle);
    } catch (error) {
      const reason = error instanceof ArStartError ? error.reason : 'failed';
      setArProblem(
        reason === 'refused'
          ? 'The immersive session was not allowed.'
          : reason === 'unsupported'
            ? 'This phone cannot run an immersive session.'
            : 'The immersive session could not start.',
      );
    } finally {
      setArStarting(false);
    }
  }, [arStarting, progressMeters, track, tracking]);

  const exit = () => {
    void arSession?.end();
    actions.setView(VIEW_TYPE.MAP);
  };

  const snapshot = live ? tracking.snapshot : null;
  const source = track
    ? facingFrom(track, live, snapshot, alignment, progressMeters).source
    : 'off';
  const showAlign = live && !arSession && source === 'assumed';
  const arActive = arSession !== null;

  return (
    <div
      className="camera-preview animate-fade-in"
      id="camera-preview"
      data-heading-source={source}
      data-facing={drawn.facing ?? ''}
      data-ribbon={drawn.points}
      data-ar={arActive ? 'active' : arSupport === 'yes' ? 'available' : arSupport}
      data-tracking={tracking?.status ?? 'none'}
    >
      {found && !cameraError && (
        <video ref={videoRef} className="camera-preview-video" playsInline muted autoPlay />
      )}
      {found && !cameraError && <canvas ref={canvasRef} className="camera-preview-canvas" />}

      {found && (
        <div className="camera-preview-status" role="status">
          <Camera size={14} />
          <strong>{arActive ? 'Immersive guidance' : 'Camera guidance'}</strong>
          <span>{arActive ? 'Anchored to your start point' : 'Not world-anchored'}</span>
        </div>
      )}

      {!found && (
        <div className="camera-preview-fallback">
          <div className="camera-preview-fallback-icon">
            <Navigation size={48} />
          </div>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' }}>
            Plan a route first
          </h3>
          <p style={{ maxWidth: '340px', color: 'var(--color-text-muted)' }}>
            Camera permission is requested only when there is a route to show.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => actions.setView(VIEW_TYPE.MAP)}
            style={{ marginTop: 'var(--space-4)' }}
          >
            <Map size={16} /> Choose a destination
          </button>
        </div>
      )}

      {found && cameraError && (
        <div className="camera-preview-fallback">
          <div className="camera-preview-fallback-icon">
            <CameraOff size={48} />
          </div>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' }}>
            Camera Access Required
          </h3>
          <p style={{ maxWidth: '320px', color: 'var(--color-text-muted)' }}>
            The camera view needs permission to draw the route over the live image.
          </p>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            Error: {cameraError}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => actions.setView(VIEW_TYPE.MAP)}
            style={{ marginTop: 'var(--space-4)' }}
          >
            <Map size={16} /> Switch to Map View
          </button>
        </div>
      )}

      {found && !cameraError && (
        <aside
          className="camera-preview-telemetry"
          aria-label="Guidance readiness"
          ref={telemetryRef}
        >
          {(showAlign || arProblem || (!live && !canTrack)) && (
            <p className="camera-preview-note" role="status">
              {arProblem
                ? arProblem
                : showAlign
                  ? 'Hold the phone up, looking along the corridor the route follows, then say so. The gyroscope keeps the route turning with you from there.'
                  : !plausible
                    ? 'This device has no motion sensors, so the route is drawn as if you were looking along it. Step through the route or play the walk-through to move.'
                    : !knownStart
                      ? 'Scan a check-in code on the map so tracking knows where you are.'
                      : 'Tracking is paused; the route is drawn as if you were looking along it.'}
            </p>
          )}
          <div>
            <Camera size={13} />
            <span>Video</span>
            <strong>{videoReady ? 'Live' : 'Starting'}</strong>
          </div>
          <div className={live ? undefined : 'not-ready'}>
            <LocateFixed size={13} />
            <span>Position</span>
            <strong>{live ? tierLabel(snapshot) : 'Not tracked'}</strong>
          </div>
          <div className={source === 'assumed' || source === 'off' ? 'not-ready' : undefined}>
            <Compass size={13} />
            <span>Heading</span>
            <strong>{headingLabel(source)}</strong>
          </div>
          <div className={arActive ? undefined : 'not-ready'}>
            <Crosshair size={13} />
            <span>World anchor</span>
            <strong>
              {arActive
                ? arReport?.floorHits
                  ? 'Floor found'
                  : 'Your start point'
                : 'Not anchored'}
            </strong>
          </div>
        </aside>
      )}

      {found && !cameraError && copy && (
        <div className="camera-preview-instruction animate-slide-down">
          <div className="camera-preview-instruction-icon">
            <ManeuverIcon type={copy.step.type} size={22} />
          </div>
          <div className="camera-preview-instruction-copy">
            <div className="camera-preview-step-kicker">
              <span className="camera-preview-lead">{copy.lead}</span>
              {live && snapshot && <span>{snapshot.tier}</span>}
            </div>
            <div className="camera-preview-instruction-text">{copy.text}</div>
            {copy.then && <div className="camera-preview-instruction-distance">{copy.then}</div>}
          </div>
        </div>
      )}

      <div className="camera-preview-controls" ref={controlsRef}>
        <button className="camera-preview-control" onClick={exit} id="btn-exit-camera-preview">
          <Map size={16} />
          Exit to plan
        </button>
        {found && !cameraError && speechAvailable() && onVoice && (
          <button
            className="camera-preview-control"
            aria-pressed={voice}
            aria-label={voice ? 'Mute spoken directions' : 'Speak directions aloud'}
            onClick={() => onVoice(!voice)}
          >
            {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {voice ? 'Mute' : 'Speak'}
          </button>
        )}
        {found && !cameraError && canTrack && (
          <button className="camera-preview-control is-primary" onClick={() => tracking.start()}>
            <LocateFixed size={16} />
            {trackLabel}
          </button>
        )}
        {found && !cameraError && showAlign && (
          <button className="camera-preview-control is-primary" onClick={alignNow}>
            <Compass size={16} />
            I’m facing the corridor
          </button>
        )}
        {found && !cameraError && live && !arSession && source === 'aligned' && (
          <button className="camera-preview-control" onClick={() => setAlignment(null)}>
            <Compass size={16} />
            Re-align
          </button>
        )}
        {found && !cameraError && arAvailable && !arSession && (
          <button className="camera-preview-control" onClick={startAr} disabled={arStarting}>
            <Box size={16} />
            {arStarting ? 'Starting AR…' : 'Start AR'}
          </button>
        )}
      </div>

      {/* Shown over the camera by the immersive session, for as long as it runs. */}
      <div
        ref={overlayRef}
        className={`camera-ar-overlay${arActive ? ' is-active' : ''}`}
        aria-hidden={!arActive}
      >
        {arActive && copy && (
          <div className="camera-preview-instruction">
            <div className="camera-preview-instruction-icon">
              <ManeuverIcon type={copy.step.type} size={22} />
            </div>
            <div className="camera-preview-instruction-copy">
              <div className="camera-preview-step-kicker">
                <span className="camera-preview-lead">{copy.lead}</span>
                {snapshot && <span>{snapshot.tier}</span>}
              </div>
              <div className="camera-preview-instruction-text">{copy.text}</div>
              {copy.then && <div className="camera-preview-instruction-distance">{copy.then}</div>}
            </div>
          </div>
        )}
        <p className="camera-ar-overlay-note">
          {arReport?.aligned
            ? 'The route is placed from where the guidance says you are, looking the way it goes. If the chevrons point into a wall, face along the corridor and re-align.'
            : 'Placing the route…'}
        </p>
        <div className="camera-preview-controls">
          <button
            className="camera-preview-control"
            onClick={() => arSession?.realign()}
            disabled={!arSession}
          >
            <Compass size={16} />
            Re-align
          </button>
          <button
            className="camera-preview-control is-primary"
            onClick={() => void arSession?.end()}
            disabled={!arSession}
          >
            <Square size={16} />
            Leave AR
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The projected route as a ribbon on the floor: blue edged in ink, sixty
 * centimetres wide at every depth, chevrons along it and a ring at the end.
 */
function paintProjection(context, viewport, projection, fadeFrom) {
  const focal =
    viewport.height / 2 / Math.tan((DEFAULT_CAMERA_MODEL.verticalFovDegrees / 2) * (Math.PI / 180));
  context.save();
  context.lineJoin = 'round';
  for (const line of projection.ribbon) {
    if (line.length < 2) continue;
    const left = [];
    const right = [];
    for (let index = 0; index < line.length; index += 1) {
      const point = line[index];
      const previous = line[Math.max(0, index - 1)];
      const next = line[Math.min(line.length - 1, index + 1)];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.hypot(dx, dy) || 1;
      const half = Math.max(2, Math.min(48, (focal / Math.max(0.3, point.depthMeters)) * 0.3));
      const nx = (-dy / length) * half;
      const ny = (dx / length) * half;
      left.push([point.x + nx, point.y + ny]);
      right.push([point.x - nx, point.y - ny]);
    }
    context.beginPath();
    context.moveTo(left[0][0], left[0][1]);
    for (let index = 1; index < left.length; index += 1) {
      context.lineTo(left[index][0], left[index][1]);
    }
    for (let index = right.length - 1; index >= 0; index -= 1) {
      context.lineTo(right[index][0], right[index][1]);
    }
    context.closePath();
    context.fillStyle = 'rgba(10, 101, 219, 0.82)';
    context.fill();
    context.strokeStyle = 'rgba(0, 6, 9, 0.7)';
    context.lineWidth = 2;
    context.stroke();
  }
  for (const chevron of projection.chevrons) {
    const size = Math.max(4, Math.min(18, chevron.pixelsPerMeter * 0.2));
    context.save();
    context.translate(chevron.x, chevron.y);
    context.rotate(chevron.angleRadians);
    context.beginPath();
    context.moveTo(-size * 0.55, -size * 0.8);
    context.lineTo(size * 0.45, 0);
    context.lineTo(-size * 0.55, size * 0.8);
    context.strokeStyle = CREAM;
    context.lineCap = 'round';
    context.lineWidth = Math.max(2, size * 0.22);
    context.stroke();
    context.restore();
  }
  if (projection.destination) {
    const radius = Math.max(8, Math.min(40, 400 / Math.max(1, projection.destination.depthMeters)));
    context.beginPath();
    context.arc(projection.destination.x, projection.destination.y, radius, 0, Math.PI * 2);
    context.strokeStyle = INK;
    context.lineWidth = 6;
    context.stroke();
    context.strokeStyle = CREAM;
    context.lineWidth = 3;
    context.stroke();
  }
  // The near end of the ribbon would run under the panels: let it go before it gets there.
  if (fadeFrom !== null && fadeFrom < viewport.height) {
    const start = Math.max(0, fadeFrom - 90);
    const gradient = context.createLinearGradient(0, start, 0, Math.max(start + 1, fadeFrom));
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = gradient;
    context.fillRect(0, start, viewport.width, viewport.height - start);
  }
  context.restore();
}
