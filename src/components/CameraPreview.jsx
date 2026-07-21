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
  CornerUpLeft,
  CornerUpRight,
  Map,
  Navigation,
} from 'lucide-react';
import { useNavigation, VIEW_TYPE, NAV_STATUS } from '../context/NavigationContext.jsx';
import { STEP_TYPE } from '../engine/routingEngine';
import { formatDistance } from '../data/buildingConfig.js';

export default function CameraPreview() {
  const { state, actions } = useNavigation();
  const { activeView, route, navStatus, currentStepIndex } = state;
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
}) {
  useEffect(() => {
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
  }, [animationFrameRef, setCameraError, setIsVideoReady, streamRef, videoRef]);

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
    if (!isVideoReady || !canvasRef.current) return undefined;

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
        drawPreviewOverlay(context, { width, height }, currentStep);
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [animationFrameRef, canvasRef, currentStep, isNavigating, isVideoReady]);

  return (
    <div className="camera-preview animate-fade-in" id="camera-preview">
      {!cameraError && (
        <video ref={videoRef} className="camera-preview-video" playsInline muted autoPlay />
      )}

      {!cameraError && <canvas ref={canvasRef} className="camera-preview-canvas" />}

      <div className="camera-preview-status" role="status">
        <Camera size={14} />
        <strong>Camera preview</strong>
        <span>Screen-aligned · not spatially anchored</span>
      </div>

      {cameraError && (
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
          <div>
            <div className="camera-preview-instruction-text">{currentStep.instruction}</div>
            {currentStep.distance > 0 && (
              <div className="camera-preview-instruction-distance">
                {formatDistance(currentStep.distance)}
              </div>
            )}
          </div>
        </div>
      )}

      {!cameraError && !isNavigating && (
        <div className="camera-preview-instruction animate-slide-down">
          <div
            className="camera-preview-instruction-icon"
            style={{ background: 'var(--color-accent-amber)' }}
          >
            <Navigation size={22} />
          </div>
          <div>
            <div className="camera-preview-instruction-text">No active navigation</div>
            <div
              className="camera-preview-instruction-distance"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Choose a destination on the map to preview its instructions.
            </div>
          </div>
        </div>
      )}

      <div className="camera-preview-controls">
        <button
          className="camera-preview-control"
          onClick={() => actions.setView(VIEW_TYPE.MAP)}
          id="btn-exit-camera-preview"
        >
          <Map size={16} />
          Map View
        </button>
        {isNavigating && (
          <>
            <button
              className="camera-preview-control"
              onClick={() => actions.prevStep()}
              disabled={currentStepIndex === 0}
            >
              ← Prev
            </button>
            <button
              className="camera-preview-control"
              onClick={() => actions.nextStep()}
              disabled={currentStepIndex >= (route?.steps?.length || 0) - 1}
            >
              Next →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function drawPreviewOverlay(context, viewport, step) {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;

  context.fillStyle = 'rgba(0, 0, 0, 0.1)';
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.save();
  context.translate(centerX, centerY - 30);

  switch (step.type) {
    case STEP_TYPE.STRAIGHT:
    case STEP_TYPE.START:
      drawStraightArrow(context);
      break;
    case STEP_TYPE.TURN_LEFT:
    case STEP_TYPE.SLIGHT_LEFT:
      drawTurnArrow(context, 'left');
      break;
    case STEP_TYPE.TURN_RIGHT:
    case STEP_TYPE.SLIGHT_RIGHT:
      drawTurnArrow(context, 'right');
      break;
    case STEP_TYPE.ARRIVE:
      drawArrivalMarker(context);
      break;
    default:
      drawStraightArrow(context);
  }

  context.restore();
  if (step.distance > 0) drawDistanceIndicator(context, viewport, step.distance);
}

function applyFloatingEffect(context) {
  const floatY = Math.sin((Date.now() / 1000) * 3) * 12;
  context.translate(0, floatY);
}

function drawStraightArrow(context) {
  const size = 70;
  applyFloatingEffect(context);

  const gradient = context.createLinearGradient(0, -size, 0, size);
  gradient.addColorStop(0, '#60a5fa');
  gradient.addColorStop(1, '#2563eb');
  context.shadowColor = 'rgba(37, 99, 235, 0.8)';
  context.shadowBlur = 40;
  context.shadowOffsetY = 15;
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(-size * 0.5, size * 0.2);
  context.lineTo(-size * 0.2, size * 0.1);
  context.lineTo(-size * 0.2, size);
  context.lineTo(size * 0.2, size);
  context.lineTo(size * 0.2, size * 0.1);
  context.lineTo(size * 0.5, size * 0.2);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.stroke();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
}

function drawTurnArrow(context, direction) {
  const flip = direction === 'left' ? -1 : 1;
  const size = 60;
  applyFloatingEffect(context);

  const gradient = context.createLinearGradient(0, -size, 0, size);
  gradient.addColorStop(0, '#60a5fa');
  gradient.addColorStop(1, '#2563eb');
  context.shadowColor = 'rgba(37, 99, 235, 0.8)';
  context.shadowBlur = 40;
  context.shadowOffsetY = 15;
  context.beginPath();
  context.moveTo(0, size);
  context.lineTo(0, 0);
  context.quadraticCurveTo(0, -size * 0.8, flip * size * 0.8, -size * 0.8);
  context.strokeStyle = gradient;
  context.lineWidth = 18;
  context.lineCap = 'round';
  context.stroke();
  context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  context.lineWidth = 4;
  context.stroke();

  const headX = flip * size * 0.8;
  const headY = -size * 0.8;
  context.beginPath();
  context.moveTo(headX + flip * 10, headY);
  context.lineTo(headX - flip * 25, headY - 25);
  context.lineTo(headX - flip * 15, headY + 25);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.stroke();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
}

function drawArrivalMarker(context) {
  const pulse = 0.8 + Math.sin((Date.now() / 1000) * 3) * 0.2;
  context.shadowColor = 'rgba(16, 185, 129, 0.6)';
  context.shadowBlur = 30;
  context.beginPath();
  context.arc(0, 0, 40 * pulse, 0, Math.PI * 2);
  context.strokeStyle = 'rgba(16, 185, 129, 0.5)';
  context.lineWidth = 3;
  context.stroke();
  context.beginPath();
  context.arc(0, 0, 20, 0, Math.PI * 2);
  context.fillStyle = 'rgba(16, 185, 129, 0.7)';
  context.fill();
  context.fillStyle = 'white';
  context.font = '24px serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('📍', 0, 0);
  context.shadowBlur = 0;
}

function drawDistanceIndicator(context, viewport, distance) {
  const y = viewport.height - 100;
  context.fillStyle = 'rgba(17, 22, 49, 0.7)';
  context.beginPath();
  context.roundRect(viewport.width / 2 - 50, y - 15, 100, 30, 15);
  context.fill();
  context.fillStyle = 'rgba(96, 165, 250, 0.9)';
  context.font = '600 14px Inter, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(formatDistance(distance), viewport.width / 2, y);
}
