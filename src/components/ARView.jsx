/**
 * ARView.jsx
 * 
 * Camera-based AR overlay with directional arrows and step instructions.
 * Uses getUserMedia for camera access and Canvas for 2D overlays.
 * 
 * Performance: Camera feed and canvas drawing use refs to avoid
 * re-rendering the React component tree on every frame.
 * 
 * Designed for future scaling to WebXR when browser support matures.
 */

import { useRef, useEffect, useState } from 'react';
import { Map, CameraOff, Navigation, ArrowUp, CornerUpLeft, CornerUpRight } from 'lucide-react';
import { useNavigation, VIEW_TYPE, NAV_STATUS } from '../context/NavigationContext.jsx';
import { STEP_TYPE } from '../engine/routingEngine';
import { formatDistance } from '../data/buildingConfig.js';

export default function ARView() {
  const { state, actions } = useNavigation();
  const { activeView, route, navStatus, currentStepIndex } = state;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [isVideoReady, setIsVideoReady] = useState(false);

  // Only render when AR view is active
  if (activeView !== VIEW_TYPE.AR) return null;

  const currentStep = route?.steps?.[currentStepIndex];
  const isNavigating = navStatus === NAV_STATUS.NAVIGATING || navStatus === NAV_STATUS.ARRIVED;

  return (
    <ARViewInner
      videoRef={videoRef}
      canvasRef={canvasRef}
      streamRef={streamRef}
      animFrameRef={animFrameRef}
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

function ARViewInner({
  videoRef, canvasRef, streamRef, animFrameRef,
  cameraError, setCameraError, isVideoReady, setIsVideoReady,
  currentStep, isNavigating, route, currentStepIndex, actions
}) {
  // ── Camera Setup ──
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // Rear camera
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            setIsVideoReady(true);
          };
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Camera access failed:', err);
          setCameraError(err.message || 'Camera access denied');
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      setIsVideoReady(false);
    };
  }, [animFrameRef, setCameraError, setIsVideoReady, streamRef, videoRef]);

  // ── Canvas Drawing Loop ──
  useEffect(() => {
    if (!isVideoReady || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    function draw() {
      // Match canvas to container size
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isNavigating && currentStep) {
        drawAROverlay(ctx, canvas, currentStep);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [animFrameRef, canvasRef, isVideoReady, isNavigating, currentStep]);

  return (
    <div className="ar-view animate-fade-in" id="ar-view">
      {/* Camera Feed */}
      {!cameraError && (
        <video
          ref={videoRef}
          className="ar-video"
          playsInline
          muted
          autoPlay
        />
      )}

      {/* Canvas Overlay */}
      {!cameraError && (
        <canvas ref={canvasRef} className="ar-canvas-overlay" />
      )}

      {/* Camera Error Fallback */}
      {cameraError && (
        <div className="ar-fallback">
          <div className="ar-fallback-icon">
            <CameraOff size={48} />
          </div>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' }}>
            Camera Access Required
          </h3>
          <p style={{ maxWidth: '320px', color: 'var(--color-text-muted)' }}>
            AR navigation needs camera access to show directional overlays.
            Please allow camera permissions and reload.
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

      {/* Instruction Card */}
      {!cameraError && isNavigating && currentStep && (
        <div className="ar-instruction-card animate-slide-down" id="ar-instruction">
          <div className="ar-instruction-icon">
            {currentStep.type === STEP_TYPE.TURN_LEFT && <CornerUpLeft size={22} />}
            {currentStep.type === STEP_TYPE.TURN_RIGHT && <CornerUpRight size={22} />}
            {(currentStep.type === STEP_TYPE.STRAIGHT || currentStep.type === STEP_TYPE.START) && <ArrowUp size={22} />}
            {currentStep.type === STEP_TYPE.ARRIVE && <Navigation size={22} />}
            {currentStep.type === STEP_TYPE.SLIGHT_LEFT && <CornerUpLeft size={22} />}
            {currentStep.type === STEP_TYPE.SLIGHT_RIGHT && <CornerUpRight size={22} />}
          </div>
          <div>
            <div className="ar-instruction-text">{currentStep.instruction}</div>
            {currentStep.distance > 0 && (
              <div className="ar-instruction-distance">
                {formatDistance(currentStep.distance)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No Route Info */}
      {!cameraError && !isNavigating && (
        <div className="ar-instruction-card animate-slide-down">
          <div className="ar-instruction-icon" style={{ background: 'var(--color-accent-amber)' }}>
            <Navigation size={22} />
          </div>
          <div>
            <div className="ar-instruction-text">No active navigation</div>
            <div className="ar-instruction-distance" style={{ color: 'var(--color-text-muted)' }}>
              Search for a destination to start AR navigation
            </div>
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      <div className="ar-bottom-bar">
        <button
          className="ar-exit-btn"
          onClick={() => actions.setView(VIEW_TYPE.MAP)}
          id="btn-exit-ar"
        >
          <Map size={16} />
          Map View
        </button>
        {isNavigating && (
          <>
            <button
              className="ar-exit-btn"
              onClick={() => actions.prevStep()}
              disabled={currentStepIndex === 0}
              style={{ opacity: currentStepIndex === 0 ? 0.4 : 1 }}
            >
              ← Prev
            </button>
            <button
              className="ar-exit-btn"
              onClick={() => actions.nextStep()}
              disabled={currentStepIndex >= (route?.steps?.length || 0) - 1}
              style={{ opacity: currentStepIndex >= (route?.steps?.length || 0) - 1 ? 0.4 : 1 }}
            >
              Next →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Draw AR directional overlays on the canvas.
 * Uses simple 2D graphics — no WebXR needed.
 */
function drawAROverlay(ctx, canvas, step) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Semi-transparent overlay background (subtle)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw directional arrow based on step type
  ctx.save();
  ctx.translate(cx, cy - 30);

  switch (step.type) {
    case STEP_TYPE.STRAIGHT:
    case STEP_TYPE.START:
      drawStraightArrow(ctx);
      break;
    case STEP_TYPE.TURN_LEFT:
    case STEP_TYPE.SLIGHT_LEFT:
      drawTurnArrow(ctx, 'left');
      break;
    case STEP_TYPE.TURN_RIGHT:
    case STEP_TYPE.SLIGHT_RIGHT:
      drawTurnArrow(ctx, 'right');
      break;
    case STEP_TYPE.ARRIVE:
      drawArrivalMarker(ctx);
      break;
    default:
      drawStraightArrow(ctx);
  }

  ctx.restore();

  // Draw distance ring at bottom
  if (step.distance > 0) {
    drawDistanceIndicator(ctx, canvas, step.distance);
  }
}

function applyFloatingEffect(ctx) {
  const time = Date.now() / 1000;
  const floatY = Math.sin(time * 3) * 12;
  ctx.translate(0, floatY);
}

function drawStraightArrow(ctx) {
  const size = 70;
  
  applyFloatingEffect(ctx);

  // Gradient fill
  const grad = ctx.createLinearGradient(0, -size, 0, size);
  grad.addColorStop(0, '#60a5fa');
  grad.addColorStop(1, '#2563eb');

  // Intense Glow
  ctx.shadowColor = 'rgba(37, 99, 235, 0.8)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 15;

  // Arrow body
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(-size * 0.5, size * 0.2);
  ctx.lineTo(-size * 0.2, size * 0.1);
  ctx.lineTo(-size * 0.2, size);
  ctx.lineTo(size * 0.2, size);
  ctx.lineTo(size * 0.2, size * 0.1);
  ctx.lineTo(size * 0.5, size * 0.2);
  ctx.closePath();

  ctx.fillStyle = grad;
  ctx.fill();
  
  // White crisp border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawTurnArrow(ctx, direction) {
  const flip = direction === 'left' ? -1 : 1;
  const size = 60;

  applyFloatingEffect(ctx);

  // Gradient fill
  const grad = ctx.createLinearGradient(0, -size, 0, size);
  grad.addColorStop(0, '#60a5fa');
  grad.addColorStop(1, '#2563eb');

  ctx.shadowColor = 'rgba(37, 99, 235, 0.8)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 15;

  // Curved arrow path
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(0, 0);
  ctx.quadraticCurveTo(0, -size * 0.8, flip * size * 0.8, -size * 0.8);
  
  ctx.strokeStyle = grad;
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.stroke();

  // White inner highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Arrowhead
  const headX = flip * size * 0.8;
  const headY = -size * 0.8;
  ctx.beginPath();
  ctx.moveTo(headX + flip * 10, headY);
  ctx.lineTo(headX - flip * 25, headY - 25);
  ctx.lineTo(headX - flip * 15, headY + 25);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  
  // Arrowhead border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawArrivalMarker(ctx) {
  // Pulsing circle
  const time = Date.now() / 1000;
  const pulse = 0.8 + Math.sin(time * 3) * 0.2;

  ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
  ctx.shadowBlur = 30;

  // Outer ring
  ctx.beginPath();
  ctx.arc(0, 0, 40 * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Inner circle
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
  ctx.fill();

  // Pin icon
  ctx.fillStyle = 'white';
  ctx.font = '24px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📍', 0, 0);

  ctx.shadowBlur = 0;
}

function drawDistanceIndicator(ctx, canvas, distance) {
  const y = canvas.height - 100;
  const text = formatDistance(distance);

  ctx.fillStyle = 'rgba(17, 22, 49, 0.7)';
  ctx.beginPath();
  ctx.roundRect(canvas.width / 2 - 50, y - 15, 100, 30, 15);
  ctx.fill();

  ctx.fillStyle = 'rgba(96, 165, 250, 0.9)';
  ctx.font = '600 14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, y);
}
