import { useEffect, useId, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { FloorModelControls } from '../map/hospitalFloorModel';

export default function HospitalFloorModel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controls = useRef<FloorModelControls | null>(null);
  const instructionId = useId();
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let closed = false;
    void import('../map/hospitalFloorModel')
      .then(({ openFloorModel }) => {
        if (!closed) controls.current = openFloorModel(canvas, setStatus);
      })
      .catch(() => {
        if (!closed) setStatus('failed');
      });
    return () => {
      closed = true;
      controls.current?.dispose();
      controls.current = null;
    };
  }, [attempt]);

  return (
    <div className="hospital-floor-model" data-model-state={status}>
      <div className="hospital-floor-stage">
        <canvas
          key={attempt}
          ref={canvasRef}
          tabIndex={status === 'ready' ? 0 : -1}
          role="group"
          aria-label="Interactive hospital floor"
          aria-describedby={instructionId}
        />
        {status === 'loading' && (
          <span className="hospital-floor-notice" role="status">
            Loading the floor model…
          </span>
        )}
        {status === 'failed' && (
          <div className="hospital-floor-notice">
            <span role="status">The floor model could not be displayed.</span>
            <button
              type="button"
              onClick={() => {
                setStatus('loading');
                setAttempt(attempt + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {status === 'ready' && (
          <div className="hospital-floor-tools" role="group" aria-label="Floor model controls">
            <button
              type="button"
              aria-label="Zoom in on floor model"
              onClick={() => controls.current?.zoom(true)}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Zoom out of floor model"
              onClick={() => controls.current?.zoom(false)}
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Fit whole floor"
              onClick={() => controls.current?.fit()}
            >
              <Maximize size={17} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <p id={instructionId} className="hospital-floor-help">
        Drag to rotate. Use two fingers to pan or pinch to zoom. Arrow keys rotate, Shift + arrows
        pan, and Home fits the whole floor.
      </p>
    </div>
  );
}
