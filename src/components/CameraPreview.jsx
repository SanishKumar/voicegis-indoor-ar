/**
 * Camera overlay preview for exercising route instructions.
 *
 * This view intentionally does not claim spatial AR. It has no device pose,
 * world anchor, or user localization, so its graphics remain screen-aligned.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Camera,
  CameraOff,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  LocateFixed,
  Map,
  Navigation,
} from 'lucide-react';
import { useNavigation, VIEW_TYPE, NAV_STATUS } from '../context/NavigationContext.jsx';
import { STEP_TYPE } from '../engine/routingEngine';
import { formatDistance } from '../data/buildingConfig.js';
import { readPreviewHeading, PREVIEW_HEADING_MAX_AGE_MS } from '../capture/previewHeading';
import { signedHeadingDifference } from '../navigation/coordinateFrames';

export default function CameraPreview() {
  const { state, actions } = useNavigation();
  const { activeView, route, navStatus, previewStepIndex: currentStepIndex } = state;
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [isVideoReady, setIsVideoReady] = useState(false);

  if (activeView !== VIEW_TYPE.CAMERA_PREVIEW) return null;

  const currentStep = route?.steps?.[currentStepIndex];
  const isNavigating = navStatus === NAV_STATUS.NAVIGATING || navStatus === NAV_STATUS.ARRIVED;

  return (
    <CameraPreviewInner
      videoRef={videoRef}
      canvasRef={canvasRef}
      streamRef={streamRef}
      animationFrameRef={animationFrameRef}
      cameraError={cameraError}
      setCameraError={setCameraError}
      isVideoReady={isVideoReady}
      setIsVideoReady={setIsVideoReady}
      currentStep={currentStep}
      isNavigating={isNavigating}
      route={route}
      currentStepIndex={currentStepIndex}
      actions={actions}
      venueKey={state.venueKey}
    />
  );
}

function CameraPreviewInner({
  videoRef,
  canvasRef,
  streamRef,
  animationFrameRef,
  cameraError,
  setCameraError,
  isVideoReady,
  setIsVideoReady,
  currentStep,
  isNavigating,
  route,
  currentStepIndex,
  actions,
  venueKey,
}) {
  const [headingState, setHeadingState] = useState('idle');
  const [headingEnabled, setHeadingEnabled] = useState(false);
  const [headingPreview, setHeadingPreview] = useState(null);
  const headingRequestRef = useRef(0);
  const controlsRef = useRef(null);

  useEffect(() => {
    const controls = controlsRef.current;
    const root = controls?.parentElement;
    if (!controls || !root) return undefined;
    // Controls wrap on phones. Telemetry must clear their measured height,
    // otherwise it covers the map escape when a second row appears.
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

  const directionalStep =
    currentStep &&
    [
      STEP_TYPE.START,
      STEP_TYPE.STRAIGHT,
      STEP_TYPE.TURN_LEFT,
      STEP_TYPE.TURN_RIGHT,
      STEP_TYPE.SLIGHT_LEFT,
      STEP_TYPE.SLIGHT_RIGHT,
      STEP_TYPE.U_TURN,
    ].includes(currentStep.type) &&
    currentStep.distance > 0;
  const routeBearing =
    directionalStep && Number.isFinite(currentStep.bearing) ? currentStep.bearing : null;
  const planHeading = headingPreview?.planHeading;
  const headingDelta =
    planHeading?.status === 'known' && routeBearing !== null
      ? signedHeadingDifference(routeBearing, planHeading.degrees)
      : null;
  const stepCount = route?.steps?.length ?? 0;
  const routeProgress = stepCount > 0 ? ((currentStepIndex + 1) / stepCount) * 100 : 0;

  const enableHeading = async () => {
    const request = ++headingRequestRef.current;
    setHeadingPreview(null);
    if (document.visibilityState === 'hidden') {
      setHeadingState('paused');
      return;
    }
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      setHeadingState('unavailable');
      return;
    }

    setHeadingState('requesting');
    try {
      const OrientationEvent = window.DeviceOrientationEvent;
      if (typeof OrientationEvent.requestPermission === 'function') {
        const permission = await OrientationEvent.requestPermission(true);
        if (request !== headingRequestRef.current) return;
        if (permission !== 'granted') {
          setHeadingState('denied');
          return;
        }
      }
      if (request !== headingRequestRef.current || document.visibilityState === 'hidden') return;
      setHeadingEnabled(true);
      setHeadingState('listening');
    } catch {
      if (request === headingRequestRef.current) setHeadingState('denied');
    }
  };

  useEffect(() => {
    // Also cancels a pending permission request; resuming the page requires
    // another explicit opt-in instead of reviving stale directional telemetry.
    const pause = () => {
      if (document.visibilityState !== 'hidden') return;
      headingRequestRef.current += 1;
      setHeadingEnabled(false);
      setHeadingPreview(null);
      setHeadingState('paused');
    };
    document.addEventListener('visibilitychange', pause);
    return () => {
      headingRequestRef.current += 1;
      document.removeEventListener('visibilitychange', pause);
    };
  }, []);

  useEffect(() => {
    if (!headingEnabled || !isNavigating || cameraError) return undefined;
    let lastEventTime = performance.now();

    const handleOrientation = (event) => {
      if (document.visibilityState === 'hidden') return;
      const nowMs = performance.now();
      lastEventTime = Math.min(nowMs, event.timeStamp);
      setHeadingPreview(readPreviewHeading(event, nowMs, venueKey));
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    const watchdog = window.setInterval(() => {
      if (
        !Number.isFinite(lastEventTime) ||
        performance.now() - lastEventTime > PREVIEW_HEADING_MAX_AGE_MS
      ) {
        setHeadingPreview(null);
        setHeadingState('stale');
      }
    }, 250);
    return () => {
      window.clearInterval(watchdog);
      window.removeEventListener('deviceorientation', handleOrientation, true);
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
    };
  }, [cameraError, headingEnabled, isNavigating, venueKey]);

  useEffect(() => {
    if (!isNavigating) return undefined;
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current
              ?.play()
              .then(() => setIsVideoReady(true))
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
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      setIsVideoReady(false);
    };
  }, [animationFrameRef, isNavigating, setCameraError, setIsVideoReady, streamRef, videoRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return undefined;

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.max(1, Math.round(width * pixelRatio));
      const nextHeight = Math.max(1, Math.round(height * pixelRatio));

      if (canvas.width !== nextWidth) canvas.width = nextWidth;
      if (canvas.height !== nextHeight) canvas.height = nextHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);
    resizeCanvas();

    return () => resizeObserver.disconnect();
  }, [canvasRef]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    function draw() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixelRatio = width > 0 ? canvas.width / width : 1;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      if (isNavigating && currentStep) {
        drawPreviewOverlay(context, { width, height }, currentStep, headingDelta);
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [animationFrameRef, canvasRef, currentStep, headingDelta, isNavigating, isVideoReady]);

  return (
    <div className="camera-preview animate-fade-in" id="camera-preview">
      {isNavigating && !cameraError && (
        <video ref={videoRef} className="camera-preview-video" playsInline muted autoPlay />
      )}

      {isNavigating && !cameraError && <canvas ref={canvasRef} className="camera-preview-canvas" />}

      {isNavigating && (
        <div className="camera-preview-status" role="status">
          <Camera size={14} />
          <strong>Guidance preview</strong>
          <span>Not world-anchored</span>
        </div>
      )}

      {!isNavigating && (
        <div className="camera-preview-fallback">
          <div className="camera-preview-fallback-icon">
            <Navigation size={48} />
          </div>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' }}>
            Plan a route first
          </h3>
          <p style={{ maxWidth: '340px', color: 'var(--color-text-muted)' }}>
            Camera permission is requested only when there is an active route to preview.
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

      {isNavigating && cameraError && (
        <div className="camera-preview-fallback">
          <div className="camera-preview-fallback-icon">
            <CameraOff size={48} />
          </div>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' }}>
            Camera Access Required
          </h3>
          <p style={{ maxWidth: '320px', color: 'var(--color-text-muted)' }}>
            The camera preview needs permission to place route instructions over the live feed.
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

      {isNavigating && !cameraError && (
        <aside className="camera-preview-telemetry" aria-label="Guidance readiness">
          <div>
            <Camera size={13} />
            <span>Video</span>
            <strong>{isVideoReady ? 'Live' : 'Starting'}</strong>
          </div>
          <div>
            <Compass size={13} />
            <span>Heading</span>
            <strong>
              {headingPreview !== null
                ? headingPreview.label
                : headingState === 'denied'
                  ? 'Denied'
                  : headingState === 'unavailable'
                    ? 'Unavailable'
                    : headingState === 'paused'
                      ? 'Paused'
                      : headingState === 'stale'
                        ? 'Stale'
                        : headingState === 'requesting'
                          ? 'Requesting'
                          : headingState === 'listening'
                            ? 'Waiting'
                            : 'Not enabled'}
            </strong>
          </div>
          <div>
            <LocateFixed size={13} />
            <span>Position</span>
            <strong>Not tracked</strong>
          </div>
          <div className="not-ready">
            <Crosshair size={13} />
            <span>World anchor</span>
            <strong>Required</strong>
          </div>
        </aside>
      )}

      {!cameraError && isNavigating && currentStep && (
        <div className="camera-preview-instruction animate-slide-down">
          <div className="camera-preview-instruction-icon">
            {currentStep.type === STEP_TYPE.TURN_LEFT && <CornerUpLeft size={22} />}
            {currentStep.type === STEP_TYPE.TURN_RIGHT && <CornerUpRight size={22} />}
            {(currentStep.type === STEP_TYPE.STRAIGHT || currentStep.type === STEP_TYPE.START) && (
              <ArrowUp size={22} />
            )}
            {currentStep.type === STEP_TYPE.ARRIVE && <Navigation size={22} />}
            {currentStep.type === STEP_TYPE.SLIGHT_LEFT && <CornerUpLeft size={22} />}
            {currentStep.type === STEP_TYPE.SLIGHT_RIGHT && <CornerUpRight size={22} />}
          </div>
          <div className="camera-preview-instruction-copy">
            <div className="camera-preview-step-kicker">
              Preview instruction {currentStepIndex + 1} / {stepCount}
              {headingDelta !== null && (
                <span>
                  {Math.abs(headingDelta) < 12
                    ? 'Aligned'
                    : `${Math.round(Math.abs(headingDelta))}° ${headingDelta < 0 ? 'left' : 'right'}`}
                </span>
              )}
            </div>
            <div className="camera-preview-instruction-text">{currentStep.instruction}</div>
            {currentStep.distance > 0 && (
              <div className="camera-preview-instruction-distance">
                {formatDistance(currentStep.distance)}
              </div>
            )}
            <div className="camera-preview-progress" aria-hidden="true">
              <span style={{ width: `${routeProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="camera-preview-controls" ref={controlsRef}>
        <button
          className="camera-preview-control"
          onClick={() => actions.setView(VIEW_TYPE.MAP)}
          id="btn-exit-camera-preview"
        >
          <Map size={16} />
          Exit to plan
        </button>
        {isNavigating && !cameraError && (
          <button
            className="camera-preview-control heading"
            disabled={headingState === 'requesting'}
            onClick={
              headingEnabled
                ? () => {
                    headingRequestRef.current += 1;
                    setHeadingEnabled(false);
                    setHeadingPreview(null);
                    setHeadingState('idle');
                  }
                : enableHeading
            }
          >
            <Compass size={16} />
            {headingEnabled ? 'Disable heading' : 'Enable heading'}
          </button>
        )}
        {isNavigating && (
          <>
            <button
              className="camera-preview-control"
              onClick={() => actions.prevStep()}
              disabled={currentStepIndex === 0}
            >
              ← Preview back
            </button>
            <button
              className="camera-preview-control"
              onClick={() => actions.nextStep()}
              disabled={currentStepIndex >= (route?.steps?.length || 0) - 1}
            >
              Preview next →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function drawPreviewOverlay(context, viewport, step, headingDelta) {
  const centerX = viewport.width / 2;
  const directionOffset =
    step.type === STEP_TYPE.TURN_LEFT || step.type === STEP_TYPE.SLIGHT_LEFT
      ? -viewport.width * 0.16
      : step.type === STEP_TYPE.TURN_RIGHT || step.type === STEP_TYPE.SLIGHT_RIGHT
        ? viewport.width * 0.16
        : 0;
  const headingOffset =
    headingDelta === null
      ? 0
      : Math.max(-1, Math.min(1, headingDelta / 90)) * viewport.width * 0.24;
  const targetX = centerX + headingOffset + directionOffset;
  const start = [centerX, viewport.height * 0.82];
  const decision = [centerX, viewport.height * 0.61];
  const target = [targetX, viewport.height * 0.43];

  context.fillStyle = 'rgba(9, 10, 12, 0.12)';
  context.fillRect(0, 0, viewport.width, viewport.height);
  drawHeadingRuler(context, viewport, headingDelta);

  if (step.type === STEP_TYPE.ARRIVE) {
    drawArrivalMarker(context, target);
  } else {
    drawRouteRibbon(context, [start, decision, target]);
    drawArrowHead(context, decision, target);
  }

  drawReticle(context, viewport);
  if (step.distance > 0) drawDistanceIndicator(context, viewport, step.distance);
}

function drawHeadingRuler(context, viewport, headingDelta) {
  const y = viewport.height * 0.34;
  const centerX = viewport.width / 2;
  context.save();
  context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(centerX - 100, y);
  context.lineTo(centerX + 100, y);
  context.stroke();

  for (let index = -4; index <= 4; index += 1) {
    const x = centerX + index * 25;
    context.beginPath();
    context.moveTo(x, y - (index === 0 ? 8 : 4));
    context.lineTo(x, y + (index === 0 ? 8 : 4));
    context.stroke();
  }

  context.fillStyle = 'rgba(255, 255, 255, 0.82)';
  context.font = '600 10px ui-monospace, Consolas, monospace';
  context.textAlign = 'center';
  const label =
    headingDelta === null
      ? 'SCREEN-ALIGNED'
      : Math.abs(headingDelta) < 12
        ? 'ROUTE ALIGNED'
        : `ROUTE ${Math.round(Math.abs(headingDelta))}° ${headingDelta < 0 ? 'LEFT' : 'RIGHT'}`;
  context.fillText(label, centerX, y - 15);
  context.restore();
}

function drawRouteRibbon(context, points) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(...points[0]);
  points.slice(1).forEach((point) => context.lineTo(...point));
  context.strokeStyle = 'rgba(18, 19, 22, 0.9)';
  context.lineWidth = 30;
  context.stroke();
  context.strokeStyle = '#ff5c39';
  context.lineWidth = 13;
  context.stroke();
  context.restore();
}

function drawArrowHead(context, from, to) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = 24;
  context.save();
  context.translate(to[0], to[1]);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(size, 0);
  context.lineTo(-size * 0.7, -size * 0.65);
  context.lineTo(-size * 0.7, size * 0.65);
  context.closePath();
  context.fillStyle = '#ff5c39';
  context.fill();
  context.strokeStyle = '#151619';
  context.lineWidth = 6;
  context.stroke();
  context.restore();
}

function drawReticle(context, viewport) {
  const centerX = viewport.width / 2;
  const centerY = viewport.height * 0.51;
  context.save();
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(centerX - 18, centerY);
  context.lineTo(centerX + 18, centerY);
  context.moveTo(centerX, centerY - 18);
  context.lineTo(centerX, centerY + 18);
  context.stroke();
  context.restore();
}

function drawArrivalMarker(context, target) {
  const pulse = 1 + Math.sin((Date.now() / 1000) * 3) * 0.08;
  context.save();
  context.translate(target[0], target[1]);
  context.beginPath();
  context.arc(0, 0, 34 * pulse, 0, Math.PI * 2);
  context.strokeStyle = '#f7f3eb';
  context.lineWidth = 4;
  context.stroke();
  context.beginPath();
  context.arc(0, 0, 16, 0, Math.PI * 2);
  context.fillStyle = '#16825d';
  context.fill();
  context.restore();
}

function drawDistanceIndicator(context, viewport, distance) {
  const y = viewport.height - 116;
  const width = 104;
  context.fillStyle = 'rgba(24, 25, 28, 0.9)';
  context.fillRect(viewport.width / 2 - width / 2, y - 17, width, 34);
  context.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  context.lineWidth = 1;
  context.strokeRect(viewport.width / 2 - width / 2, y - 17, width, 34);
  context.fillStyle = '#fff3ed';
  context.font = '700 13px Inter, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(formatDistance(distance), viewport.width / 2, y);
}
