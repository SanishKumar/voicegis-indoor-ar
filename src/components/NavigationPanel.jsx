/**
 * NavigationPanel.jsx
 * 
 * Active navigation bottom sheet with turn-by-turn directions,
 * progress indicator, and step controls.
 */

import { 
  ArrowUp, CornerUpLeft, CornerUpRight, ArrowUpLeft, ArrowUpRight,
  MapPin, CircleDot, X, ChevronLeft, ChevronRight, Navigation
} from 'lucide-react';
import { useNavigation, NAV_STATUS } from '../context/NavigationContext.jsx';
import { getNodeById, CATEGORIES } from '../data/buildingGraph.js';
import { formatDistance, estimateWalkTime } from '../data/buildingConfig.js';
import { STEP_TYPE } from '../engine/routingEngine.js';

/**
 * Get the Lucide icon component for a step type.
 */
function StepIcon({ type, size = 20 }) {
  switch (type) {
    case STEP_TYPE.START: return <CircleDot size={size} />;
    case STEP_TYPE.STRAIGHT: return <ArrowUp size={size} />;
    case STEP_TYPE.TURN_LEFT: return <CornerUpLeft size={size} />;
    case STEP_TYPE.TURN_RIGHT: return <CornerUpRight size={size} />;
    case STEP_TYPE.SLIGHT_LEFT: return <ArrowUpLeft size={size} />;
    case STEP_TYPE.SLIGHT_RIGHT: return <ArrowUpRight size={size} />;
    case STEP_TYPE.U_TURN: return <CornerUpLeft size={size} />;
    case STEP_TYPE.ARRIVE: return <MapPin size={size} />;
    default: return <ArrowUp size={size} />;
  }
}

export default function NavigationPanel() {
  const { state, actions } = useNavigation();
  const { route, navStatus, currentStepIndex, destinationNodeId, startNodeId } = state;

  // Only show when navigating
  if (navStatus === NAV_STATUS.IDLE || !route?.found) {
    return null;
  }

  const destNode = getNodeById(destinationNodeId);
  const cat = destNode?.poi ? CATEGORIES[destNode.poi.category] : null;
  const steps = route.steps;
  const currentStep = steps[currentStepIndex];
  const progress = steps.length > 1 ? (currentStepIndex / (steps.length - 1)) * 100 : 0;
  const isArrived = navStatus === NAV_STATUS.ARRIVED;

  // Calculate remaining distance
  const remainingDistance = steps
    .slice(currentStepIndex)
    .reduce((sum, s) => sum + (s.distance || 0), 0);

  return (
    <div className={`nav-panel open`} id="nav-panel">
      {/* Handle */}
      <div className="nav-panel-handle" />

      {/* Header */}
      <div className="nav-panel-header">
        <div className="nav-panel-destination">
          <div className="nav-panel-dest-icon">
            <Navigation size={18} />
          </div>
          <div>
            <div className="nav-panel-dest-name">
              {destNode?.poi?.name || 'Destination'}
            </div>
            <div className="nav-panel-dest-eta">
              {isArrived
                ? '✅ You have arrived!'
                : `${formatDistance(remainingDistance)} · ~${estimateWalkTime(remainingDistance)}`
              }
            </div>
          </div>
        </div>
        <button
          className="nav-panel-close-btn"
          onClick={() => actions.clearRoute()}
          id="btn-cancel-nav"
        >
          <X size={12} /> Cancel
        </button>
      </div>

      {/* Progress Bar */}
      <div className="nav-progress-bar">
        <div className="nav-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Current Step (Hero) */}
      {currentStep && !isArrived && (
        <div className="nav-current-step animate-slide-down" id="current-step">
          <div className="nav-step-direction-icon">
            <StepIcon type={currentStep.type} size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="nav-step-instruction">{currentStep.instruction}</div>
            {currentStep.distance > 0 && (
              <div className="nav-step-distance">
                {formatDistance(currentStep.distance)}
              </div>
            )}
          </div>
          {/* Step navigation */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => actions.prevStep()}
              disabled={currentStepIndex === 0}
              style={{ width: '32px', height: '32px', opacity: currentStepIndex === 0 ? 0.3 : 1 }}
              id="btn-prev-step"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => actions.nextStep()}
              disabled={currentStepIndex >= steps.length - 1}
              style={{ width: '32px', height: '32px', opacity: currentStepIndex >= steps.length - 1 ? 0.3 : 1 }}
              id="btn-next-step"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Arrived State */}
      {isArrived && (
        <div className="nav-current-step" style={{ 
          background: 'var(--color-accent-green-dim)', 
          borderColor: 'rgba(16, 185, 129, 0.2)' 
        }}>
          <div className="nav-step-direction-icon" style={{ background: 'var(--color-accent-green)' }}>
            <MapPin size={24} />
          </div>
          <div>
            <div className="nav-step-instruction">You have arrived!</div>
            <div className="nav-step-distance" style={{ color: 'var(--color-accent-green)' }}>
              {destNode?.poi?.name}
            </div>
          </div>
        </div>
      )}

      {/* Steps List */}
      <div className="nav-steps-list" id="nav-steps-list">
        {steps.map((step, i) => {
          let itemClass = 'nav-step-item';
          if (i < currentStepIndex) itemClass += ' completed';
          if (i === currentStepIndex) itemClass += ' active';

          return (
            <div key={i} className={itemClass}>
              <div className="nav-step-num">
                {i < currentStepIndex ? '✓' : i + 1}
              </div>
              <div className="nav-step-text">
                {step.instruction}
                {step.distance > 0 && (
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: '8px' }}>
                    ({formatDistance(step.distance)})
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
