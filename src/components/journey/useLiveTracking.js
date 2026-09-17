import { useCallback, useEffect, useRef, useState } from 'react';
import { headingRateDegreesPerSecond } from '@voicegis/localization-core';
import { HANDSET_SENSOR_PROFILE } from '../../capture/handsetCapture';
import { startHandsetSubscription } from '../../capture/handsetSubscription';
import { wrapDegrees } from '../../navigation/coordinateFrames';
import { ANCHOR_SIGMA, RouteTracker } from '../../navigation/liveTracker';

/** How often the tracker's state is read out to the screen. */
const PUBLISH_MS = 200;
/** A tilt reading this far from a motion sample, either way, still describes it. */
const TILT_MAX_AGE_MS = 300;
/** Motion events with no accelerometer in them, in a row, before the phone is judged to have none. */
const INCOMPLETE_BEFORE_UNSUPPORTED = 30;
/** Progress changes smaller than this are not worth a render. */
const PROGRESS_STEP_METERS = 0.05;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether this page could plausibly track a walk at all. Presence, not permission. */
export function sensorsPlausible() {
  return (
    typeof window !== 'undefined' &&
    globalThis.isSecureContext === true &&
    'DeviceMotionEvent' in window &&
    'DeviceOrientationEvent' in window
  );
}

/**
 * @typedef {object} LiveTracking
 * @property {string} status
 * @property {import('../../navigation/liveTracker').TrackerSnapshot | null} snapshot
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => void} confirmFloor
 * @property {boolean} plausible
 * @property {() => { gravity: { x: number, y: number, z: number } | null, snapshot: import('../../navigation/liveTracker').TrackerSnapshot | null }} peek
 * @property {() => import('../../navigation/liveTracker').RouteTracker | null} tracker
 */

/**
 * Live progress along the route from the phone's motion sensors.
 *
 * Owns the sensor subscription, pairs each motion sample with the freshest
 * tilt, reduces the pair to what the tracker reads, and publishes the
 * tracker's view a few times a second. Starting must happen inside a tap:
 * iOS grants motion access only from a real gesture.
 *
 * A new route from a scan re-anchors the tracker at its start. The tracker
 * itself survives route changes so the stride it has measured is kept.
 */
export function useLiveTracking({
  track,
  locationBasis,
  checkInDistanceMeters = 0,
  northOffsetDegrees = 0,
  setProgress,
  active,
}) /** @type {LiveTracking} */ {
  const [status, setStatus] = useState('off');
  const [snapshot, setSnapshot] = useState(null);
  const trackerRef = useRef(null);
  const disposeRef = useRef(null);
  const tiltRef = useRef(null);
  const gravityRef = useRef(null);
  const incompleteRef = useRef(0);
  const lastPublishedRef = useRef(null);
  const anchorRef = useRef({ locationBasis, checkInDistanceMeters });
  const setProgressRef = useRef(setProgress);
  const activeRef = useRef(active);
  // Callbacks read these later, so a commit's worth of lag is fine.
  useEffect(() => {
    anchorRef.current = { locationBasis, checkInDistanceMeters };
    setProgressRef.current = setProgress;
    activeRef.current = active;
  });

  const anchorIfKnown = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    const { locationBasis: basis, checkInDistanceMeters: offset } = anchorRef.current;
    if (basis === 'qr') {
      // The route starts at the routable node nearest the sign, which is
      // that far from where the visitor is actually standing.
      tracker.anchor({
        progressMeters: 0,
        sigmaMeters: ANCHOR_SIGMA.scan + Math.max(0, offset || 0),
        timeMs: performance.now(),
      });
    } else if (basis === 'selected') {
      tracker.anchor({
        progressMeters: 0,
        sigmaMeters: ANCHOR_SIGMA.selected,
        timeMs: performance.now(),
      });
    }
  }, []);

  const publish = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    const next = tracker.read(performance.now());
    const last = lastPublishedRef.current;
    const progressMoved =
      last === null || Math.abs(next.progressMeters - last.progressMeters) >= PROGRESS_STEP_METERS;
    if (progressMoved && (next.moving || next.reason === 'floor-change')) {
      setProgressRef.current(next.progressMeters);
    }
    const changed =
      last === null ||
      next.tier !== last.tier ||
      next.reason !== last.reason ||
      progressMoved ||
      Math.abs(next.sigmaMeters - last.sigmaMeters) >= 0.1 ||
      next.headingDegrees !== last.headingDegrees;
    if (changed) {
      lastPublishedRef.current = next;
      setSnapshot(next);
    }
  }, []);

  const stop = useCallback(() => {
    disposeRef.current?.();
    disposeRef.current = null;
    tiltRef.current = null;
    gravityRef.current = null;
    setStatus('off');
  }, []);

  /**
   * The freshest reading, for a view that draws every frame: the last gravity
   * vector the phone reported and the tracker's state now. Nothing here is
   * published through React, so nothing re-renders for it.
   */
  const peek = useCallback(() => {
    const tracker = trackerRef.current;
    return {
      gravity: gravityRef.current,
      snapshot: tracker === null ? null : tracker.read(performance.now()),
    };
  }, []);

  /** The tracker itself, for a pose source that feeds it directly; null until tracking has been started once. */
  const tracker = useCallback(() => trackerRef.current, []);

  const start = useCallback(() => {
    if (!track) return;
    if (!trackerRef.current) trackerRef.current = new RouteTracker(track);
    const tracker = trackerRef.current;
    if (tracker.currentTrack !== track) {
      tracker.rebind(track);
      anchorIfKnown();
    } else if (!tracker.isAnchored) {
      anchorIfKnown();
    } else {
      // Tracking the same route again after a stop carries on from where it
      // was; it does not pretend the visitor is back at the sign.
      tracker.resume(performance.now());
    }
    disposeRef.current?.();
    incompleteRef.current = 0;
    tiltRef.current = null;
    lastPublishedRef.current = null;

    const dispose = startHandsetSubscription({
      onOrientation(event) {
        if (finite(event.beta) && finite(event.gamma) && finite(event.timeStamp)) {
          tiltRef.current = { beta: event.beta, gamma: event.gamma, at: event.timeStamp };
        }
        // A compass, where the platform offers one, only ever says which way the
        // visitor is facing as they set off - and only to catch setting off the
        // wrong way. The venue's declared north offset is applied as stated;
        // it is not surveyed, which is why nothing finer than that is asked of it.
        const compass = finite(event.webkitCompassHeading)
          ? event.webkitCompassHeading
          : event.absolute === true && finite(event.alpha)
            ? wrapDegrees(360 - event.alpha)
            : null;
        if (compass !== null && finite(event.timeStamp)) {
          tracker.compassPlanBearing(wrapDegrees(compass + northOffsetDegrees), event.timeStamp);
        }
      },
      onMotion(event) {
        const acceleration = event.accelerationIncludingGravity;
        if (
          !acceleration ||
          !finite(acceleration.x) ||
          !finite(acceleration.y) ||
          !finite(acceleration.z) ||
          !finite(event.timeStamp)
        ) {
          incompleteRef.current += 1;
          if (incompleteRef.current >= INCOMPLETE_BEFORE_UNSUPPORTED) {
            tracker.sensorsLost('sensors-unavailable');
          }
          return;
        }
        incompleteRef.current = 0;
        gravityRef.current = { x: acceleration.x, y: acceleration.y, z: acceleration.z };
        const magnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
        const rotation = event.rotationRate;
        const tilt = tiltRef.current;
        let rate = null;
        if (
          rotation &&
          finite(rotation.alpha) &&
          finite(rotation.beta) &&
          finite(rotation.gamma) &&
          tilt &&
          Math.abs(event.timeStamp - tilt.at) <= TILT_MAX_AGE_MS
        ) {
          // Rotation rates are named for the orientation angles they belong
          // to, not for the axis order of a vector: alpha is about Z.
          rate = headingRateDegreesPerSecond(
            [rotation.beta, rotation.gamma, rotation.alpha],
            { alphaDegrees: 0, betaDegrees: tilt.beta, gammaDegrees: tilt.gamma, absolute: false },
            HANDSET_SENSOR_PROFILE,
          );
        }
        tracker.motion({
          timeMs: event.timeStamp,
          accelerationMagnitude: magnitude,
          headingRateDegreesPerSecond: rate,
        });
      },
      onState(state) {
        if (state === 'listening') {
          setStatus('on');
          publish();
          return;
        }
        setStatus(state);
        if (state === 'requesting') return;
        // The subscription has ended itself. A hidden page is a pause the
        // visitor can lift with a tap; the rest mean the phone cannot do this.
        disposeRef.current = null;
        if (state !== 'hidden') tracker.sensorsLost('sensors-unavailable');
        publish();
      },
    });
    disposeRef.current = dispose;
  }, [track, anchorIfKnown, northOffsetDegrees, publish]);

  const confirmFloor = useCallback(() => {
    trackerRef.current?.confirmFloor(performance.now());
    publish();
  }, [publish]);

  // A new route with the same tracker: re-anchor at its start.
  useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker || !track || tracker.currentTrack === track) return;
    tracker.rebind(track);
    anchorIfKnown();
    lastPublishedRef.current = null;
    publish();
  }, [track, anchorIfKnown, publish]);

  // Read the tracker out while listening. The same tick notices the journey
  // ending, so nothing here has to change state during a render.
  useEffect(() => {
    if (status !== 'on') return undefined;
    const timer = window.setInterval(() => {
      if (activeRef.current) publish();
      else stop();
    }, PUBLISH_MS);
    return () => window.clearInterval(timer);
  }, [status, publish, stop]);

  useEffect(() => () => disposeRef.current?.(), []);

  return {
    status,
    snapshot: status === 'off' ? null : snapshot,
    start,
    stop,
    confirmFloor,
    plausible: sensorsPlausible(),
    peek,
    tracker,
  };
}
