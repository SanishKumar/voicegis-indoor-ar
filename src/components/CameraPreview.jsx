/**
 * The camera as a window onto the same guidance as the map.
 *
 * The route ahead is drawn on the floor of the camera image from where the
 * visitor is along the route and which way the phone faces; the destination,
 * the next corner, the stair or lift and the places nearby are labelled in
 * the world where they stand, with how far away they are. Progress is the
 * same progress the map's marker uses - from live tracking or from the
 * walk-through - and the facing comes from the phone's gyroscope once
 * tracking has established the direction of travel, or from the visitor
 * saying they are looking along the corridor. None of that anchors anything
 * to the building, and the view says so in as many words.
 *
 * On a phone that can run an immersive session, the route is anchored to the
 * world instead and the phone's own tracked movement moves the marker.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Camera,
  CameraOff,
  Check,
  Compass,
  Crosshair,
  LocateFixed,
  Map as MapIcon,
  Navigation,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useNavigation, VIEW_TYPE, NAV_STATUS } from '../context/NavigationContext.jsx';
import { planBearing, signedHeadingDifference } from '../navigation/coordinateFrames';
import { bannerCopy, formatMeters, formatMinutes } from './journey/guidanceCopy';
import { speechAvailable } from './journey/useSpokenGuidance.js';
import ManeuverIcon from './journey/ManeuverIcon.jsx';
import { landmarksFrom } from '../engine/routeLandmarks';
import { bearingAt, guidanceAt, positionAt, trackForRoute } from '../navigation/routeProgress';
import { facingFrom } from '../ar/facingFrom';
import { alignedCameraHeading } from '../ar/alignedCameraHeading';
import { startOrientationFeed } from '../ar/orientationFeed';
import { calloutsAhead, shortStepTitle } from '../ar/callouts';
import { drawMiniMap, prepareMiniMap } from '../ar/cameraMiniMap';
import { createProjector, DEFAULT_CAMERA_MODEL, projectRouteAhead } from '../ar/floorProjection';
import { ArStartError, immersiveArSupported, startArGuidance } from '../ar/arSession';
import { arPrompt } from '../ar/arPrompt';
import { logField } from '../fieldTest/fieldLog';

const CREAM = '#fff9f0';
const GLOW = '#8ec5ff';
/** How often the drawn state is written out for the readiness chips and tests. */
const REPORT_MS = 200;
/** How often the world labels are recomputed from progress. */
const CALLOUTS_MS = 250;
/** Labels float this high above the floor point they name. */
const CALLOUT_HEIGHT_METERS = 1.7;
/** Labels further than this are not drawn. */
const CALLOUT_MAX_DEPTH_METERS = 40;
/** How far along the route to look when saying which way to turn to find it. */
const AIM_AHEAD_METERS = 8;
const ARROWS = {
  turn_left: '↰',
  turn_right: '↱',
  slight_left: '↖',
  slight_right: '↗',
  u_turn: '↶',
  stairs: '⇅',
  elevator: '⇅',
  escalator: '⇅',
  ramp: '⇅',
  arrive: '●',
};

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
      return 'From your walk';
    case 'aligned':
      return 'Set by you';
    case 'assumed':
      return 'Align camera';
    default:
      return 'Not known';
  }
}

/** Route points on one floor, split into walked and still to walk. */
function routeOnFloor(track, progress, floorId) {
  const behind = [];
  const ahead = [];
  const here = positionAt(track, progress);
  for (let index = 0; index < track.points.length; index += 1) {
    const point = track.points[index];
    if (point.floor !== floorId) continue;
    if (track.at[index] <= progress) behind.push([point.x, point.y]);
    else ahead.push([point.x, point.y]);
  }
  if (here.floor === floorId) {
    behind.push([here.x, here.y]);
    ahead.unshift([here.x, here.y]);
  }
  return { behind, ahead };
}

/** Keep one element per callout, reusing what is there. */
function syncCalloutElements(layer, elements, callouts) {
  const wanted = new Set(callouts.map((callout) => callout.id));
  for (const [id, element] of elements) {
    if (!wanted.has(id)) {
      element.remove();
      elements.delete(id);
    }
  }
  for (const callout of callouts) {
    let element = elements.get(callout.id);
    const stamp = `${callout.kicker}|${callout.title}|${callout.detail}|${callout.stepType}`;
    if (element && element.dataset.stamp === stamp) continue;
    if (!element) {
      element = document.createElement('div');
      element.hidden = true;
      layer.appendChild(element);
      elements.set(callout.id, element);
    }
    element.className = `ar-callout is-${callout.kind}`;
    element.dataset.stamp = stamp;
    element.replaceChildren();
    if (callout.kind === 'destination') {
      const pin = document.createElement('span');
      pin.className = 'ar-callout-pin';
      element.appendChild(pin);
    }
    const copy = document.createElement('span');
    copy.className = 'ar-callout-copy';
    if (callout.kicker) {
      const kicker = document.createElement('span');
      kicker.className = 'ar-callout-kicker';
      kicker.textContent = callout.kicker;
      copy.appendChild(kicker);
    }
    const title = document.createElement('strong');
    title.textContent = callout.title;
    copy.appendChild(title);
    if (callout.detail) {
      const detail = document.createElement('span');
      detail.className = 'ar-callout-detail';
      detail.textContent = callout.detail;
      copy.appendChild(detail);
    }
    element.appendChild(copy);
    const arrow = callout.stepType ? ARROWS[callout.stepType] : null;
    if (arrow && callout.kind !== 'destination') {
      const glyph = document.createElement('span');
      glyph.className = 'ar-callout-arrow';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = arrow;
      element.appendChild(glyph);
    }
  }
}

/** Put every callout where its plan point is on screen; hide those behind the camera. */
function placeCallouts(elements, callouts, projector, width, height, topInset) {
  let shown = 0;
  for (const callout of callouts) {
    const element = elements.get(callout.id);
    if (!element) continue;
    const point = projector.project(callout.x, callout.y, CALLOUT_HEIGHT_METERS);
    const onScreen =
      point !== null &&
      point.depthMeters <= CALLOUT_MAX_DEPTH_METERS &&
      point.x > -80 &&
      point.x < width + 80 &&
      point.y > topInset &&
      point.y < height + 40;
    if (!onScreen) {
      if (!element.hidden) element.hidden = true;
      continue;
    }
    shown += 1;
    if (element.hidden) element.hidden = false;
    // Nearer labels are a little larger and drawn over further ones.
    const scale = Math.max(0.78, Math.min(1.08, 0.7 + 4 / point.depthMeters));
    element.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    element.style.opacity = String(Math.max(0.35, Math.min(1, 1.3 - point.depthMeters / 32)));
    element.style.zIndex = String(Math.round(1000 - point.depthMeters * 10));
  }
  return shown;
}

function CameraGuidance({ state, actions, venue, tracking, voice, onVoice }) {
  const { route, navStatus, progressMeters, locationBasis, destinationNodeId } = state;
  const navigating = navStatus === NAV_STATUS.NAVIGATING || navStatus === NAV_STATUS.ARRIVED;
  const found = navigating && Boolean(route?.found) && route.steps.length > 0;
  const track = found ? trackForRoute(route) : null;
  const floorName = (floorId) => venue.getFloorById(floorId)?.name;
  const destinationName = venue.getNodeById?.(destinationNodeId)?.poi?.name ?? 'Destination';
  const walkSpeedMps = venue.config?.walkSpeedMps ?? 1.2;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const calloutLayerRef = useRef(null);
  const miniMapRef = useRef(null);
  const streamRef = useRef(null);
  const overlayRef = useRef(null);
  const sheetRef = useRef(null);
  const topRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [arSupport, setArSupport] = useState('checking');
  const [arSession, setArSession] = useState(null);
  const [arStarting, setArStarting] = useState(false);
  const [arProblem, setArProblem] = useState(null);
  const [arReport, setArReport] = useState(null);
  const [arStartProgress, setArStartProgress] = useState(0);
  // The preview can be at the destination before the visitor has left the
  // check-in point. All immersive copy follows the physical source too, not
  // just the world geometry; placement may wait several seconds for a floor.
  const displayProgress = arSession
    ? (arReport?.progressMeters ?? arStartProgress)
    : progressMeters;
  const guidance = track ? guidanceAt(track, displayProgress) : null;
  const riding = track ? positionAt(track, displayProgress).vertical : false;
  const copy =
    track && guidance
      ? bannerCopy(route.steps, track, guidance, displayProgress, floorName, riding)
      : null;
  const arOwnerRef = useRef(0);
  const arHandleRef = useRef(null);
  const [orientationState, setOrientationState] = useState('starting');
  const [drawn, setDrawn] = useState({
    source: 'off',
    tilted: false,
    facing: null,
    points: 0,
    callouts: 0,
    hint: null,
  });
  /*
   * The phone reports its orientation far faster than anything should be
   * re-rendered for, and the draw loop is the only reader, so the freshest
   * attitude and the zero its yaw is measured from live in refs.
   */
  const attitudeRef = useRef(null);
  const yawRef = useRef(null);
  const anchorRef = useRef(null);
  const feedRef = useRef(null);
  // The loop below draws every frame; it reads these here rather than restarting for them.
  const progressRef = useRef(progressMeters);
  const trackRef = useRef(track);
  const stepsRef = useRef(route?.steps ?? []);
  const destinationRef = useRef(destinationName);
  useEffect(() => {
    progressRef.current = progressMeters;
    trackRef.current = track;
    stepsRef.current = route?.steps ?? [];
    destinationRef.current = destinationName;
  });
  useEffect(() => {
    logField('orientation', { state: orientationState });
  }, [orientationState]);
  useEffect(() => {
    logField('camera-view', { facing: drawn.source, tilted: drawn.tilted });
  }, [drawn.source, drawn.tilted]);
  useEffect(() => {
    if (arSupport !== 'checking') logField('ar-support', { support: arSupport });
  }, [arSupport]);
  useEffect(() => {
    if (cameraError) logField('camera', { error: cameraError });
  }, [cameraError]);

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
  // An immersive session tracks the phone with its own camera and sensors,
  // so whether the motion subscription is plausible or refused is beside the point.
  const arAvailable = arSupport === 'yes' && found;
  // What genuinely stops an immersive session: nowhere to start the route
  // from, or a tracker that has stopped trusting its own position.
  const arBlocked = !knownStart || (tracking?.snapshot != null && !tracking.snapshot.canStartPose);

  // The sheet's height is what the inset map and the ribbon's fade keep clear of.
  useEffect(() => {
    const sheet = sheetRef.current;
    const root = sheet?.parentElement;
    if (!sheet || !root) return undefined;
    const publish = () =>
      root.style.setProperty('--ar-sheet-height', `${sheet.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(sheet);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--ar-sheet-height');
    };
  }, []);

  /*
   * Where the phone is pointing, for as long as the view is open. Without it
   * the route would be drawn in a fixed place on the glass however the phone
   * moved, which is a diagram rather than a view of the floor.
   */
  useEffect(() => {
    if (!found) return undefined;
    const feed = startOrientationFeed({
      onReading(reading) {
        attitudeRef.current = reading;
        if (reading === null) {
          yawRef.current = null;
          anchorRef.current = null;
          return;
        }
        yawRef.current = { degrees: reading.yawDegrees, epoch: reading.epoch };
        const anchor = anchorRef.current;
        if (anchor !== null && anchor.epoch === reading.epoch) return;
        // Keep a candidate bearing for the alignment UI, not a drawable pose.
        // Only an explicit alignment or the live estimator can place the route.
        const current = trackRef.current;
        if (!current) return;
        anchorRef.current = {
          yawDegrees: reading.yawDegrees,
          planBearing: bearingAt(current, progressRef.current),
          epoch: reading.epoch,
          source: 'route',
        };
      },
      onState: setOrientationState,
    });
    feedRef.current = feed;
    return () => {
      feed.dispose();
      feedRef.current = null;
      attitudeRef.current = null;
      yawRef.current = null;
      anchorRef.current = null;
    };
  }, [found, route, state.venueKey]);

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

  // The drawing loop: the route on the floor and the labels in the world,
  // from the freshest reading every frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = calloutLayerRef.current;
    if (!canvas || !layer || !track || cameraError) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const container = canvas.parentElement;
    let frame = 0;
    let lastReport = 0;
    let lastCallouts = -Infinity;
    const landmarks = venue.buildingPackage?.pois ? landmarksFrom(venue.buildingPackage) : [];
    let callouts = [];
    const calloutElements = new Map();
    let calloutFloor = '';
    let miniMapScene = null;
    let miniMapFloor = null;
    let lastDrawn = null;
    let fadeFrom = null;
    let topInset = 0;

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

      const attitude = feedRef.current?.read() ?? null;
      const reading = tracking?.peek ? tracking.peek() : { snapshot: null };
      const resolved = facingFrom({
        track,
        live,
        snapshot: reading.snapshot,
        yaw: yawRef.current,
        anchor: anchorRef.current,
        fallbackProgress: progressRef.current,
      });
      const { facing, progress, source } = resolved;
      /*
       * Two separate things have to be known before a path can be laid on the
       * floor, and they come from different places: which way the camera
       * looks, and how far it is tilted. A walk gives the first without the
       * second, so they are reported apart - saying the heading is unknown
       * when the tracker has just measured it would be a lie - and both are
       * required before anything is painted.
       */
      const tilted = attitude !== null;
      const here = positionAt(track, progress);
      if (miniMapFloor !== here.floor) {
        miniMapFloor = here.floor;
        miniMapScene = prepareMiniMap(venue.buildingPackage, here.floor);
      }
      const drawable =
        tilted &&
        source !== 'off' &&
        source !== 'assumed' &&
        knownStart &&
        !here.vertical &&
        (!live || reading.snapshot?.tier !== 'frozen');
      const pose = {
        x: here.x,
        y: here.y,
        facingDegrees: facing,
        pitchDegrees: attitude?.pitchDegrees ?? 0,
        rollDegrees: attitude?.rollDegrees ?? 0,
      };
      const cameraModel = { width, height, ...DEFAULT_CAMERA_MODEL };
      const projection = projectRouteAhead(track, progress, pose, cameraModel);
      const now = performance.now();

      // An immersive session draws its own floor and labels; the flat overlay stays out of its way.
      if (!arSession && drawable) {
        paintProjection(context, { width, height }, projection, fadeFrom);
        if (now - lastCallouts >= CALLOUTS_MS || calloutFloor !== here.floor) {
          lastCallouts = now;
          calloutFloor = here.floor;
          callouts = calloutsAhead({
            track,
            steps: stepsRef.current,
            progressMeters: progress,
            floorId: here.floor,
            destinationName: destinationRef.current,
            landmarks,
            walkSpeedMps,
          });
          syncCalloutElements(layer, calloutElements, callouts);
          miniMapScene = prepareMiniMap(venue.buildingPackage, here.floor);
        }
      } else if (calloutElements.size > 0) {
        layer.replaceChildren();
        calloutElements.clear();
        callouts = [];
      }
      const projector = createProjector(pose, cameraModel);
      const shown =
        arSession || !drawable
          ? 0
          : placeCallouts(calloutElements, callouts, projector, width, height, topInset);

      /*
       * Turning away from the route used to leave a blank picture with no way
       * of telling where it had gone. The way back is the angle between where
       * the phone points and the route a few metres on, and it is only worth
       * saying once that is further round than the camera can see.
       */
      let hint = null;
      if (!arSession && drawable && !projection.destination) {
        const aim = positionAt(track, Math.min(track.length, progress + AIM_AHEAD_METERS));
        const toAim = planBearing([here.x, here.y], [aim.x, aim.y]);
        const halfView = (Math.atan(width / 2 / projector.focal) * 180) / Math.PI;
        const away = toAim === null ? 0 : signedHeadingDifference(toAim, facing);
        if (toAim !== null && Math.abs(away) > halfView + 4) {
          hint = away > 0 ? 'right' : 'left';
        }
      }
      if (miniMapRef.current && miniMapScene) {
        drawMiniMap(miniMapRef.current, miniMapScene, {
          x: here.x,
          y: here.y,
          facingDegrees: drawable ? facing : 0,
          ...routeOnFloor(track, progress, here.floor),
        });
      }

      const points =
        drawable && !arSession ? projection.ribbon.reduce((sum, line) => sum + line.length, 0) : 0;
      if (now - lastReport >= REPORT_MS) {
        lastReport = now;
        // The ribbon's near end would run under the sheet; it fades out above it.
        const bounds = canvas.getBoundingClientRect();
        const sheet = sheetRef.current;
        fadeFrom = sheet ? sheet.getBoundingClientRect().top - bounds.top - 12 : height * 0.78;
        const top = topRef.current;
        topInset = top ? top.getBoundingClientRect().bottom - bounds.top + 8 : 0;
        const next = {
          source,
          tilted,
          facing: attitude ? Math.round(facing) : null,
          points,
          callouts: shown,
          hint,
        };
        if (
          lastDrawn === null ||
          next.source !== lastDrawn.source ||
          next.tilted !== lastDrawn.tilted ||
          next.facing !== lastDrawn.facing ||
          next.points !== lastDrawn.points ||
          next.callouts !== lastDrawn.callouts ||
          next.hint !== lastDrawn.hint
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
      layer.replaceChildren();
    };
  }, [arSession, cameraError, knownStart, live, track, tracking, venue, walkSpeedMps]);

  useEffect(() => {
    const cancel = () => {
      arOwnerRef.current += 1;
      void arHandleRef.current?.end();
      arHandleRef.current = null;
    };
    const hide = () => {
      cancel();
      setArSession(null);
      setArReport(null);
      setArStarting(false);
    };
    const visibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancel();
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  /** The visitor says they are looking along the corridor: fix the yaw's zero there. */
  const alignNow = () => {
    const reading = feedRef.current?.read();
    if (!reading) return;
    const yaw = yawRef.current;
    if (!track || yaw === null) return;
    anchorRef.current = {
      yawDegrees: yaw.degrees,
      // Preview progress is not where the visitor stands. This remains an
      // explicit manual declaration, not automatic sign-based alignment.
      planBearing: bearingAt(
        track,
        tracking?.tracker()?.read(performance.now()).progressMeters ?? 0,
      ),
      epoch: yaw.epoch,
      source: 'visitor',
      axis: Math.abs(reading.pitchDegrees) < 70 ? 'camera-forward' : 'device-top',
    };
  };

  /** Back to assuming the route, which the next reading will re-anchor. */
  const unalign = () => {
    anchorRef.current = null;
  };

  const startAr = async () => {
    // An immersive session tracks the phone itself. Requiring a reading from
    // the flat view's orientation feed left this button doing nothing at all on
    // phones where that feed never started - which were the phones it was for.
    if (!track || !tracking || !overlayRef.current || arStarting || arBlocked) return;
    const owner = ++arOwnerRef.current;
    setArProblem(null);
    setArStarting(true);
    const startedAt = performance.now();
    const since = () => (performance.now() - startedAt) / 1000;
    let arState = null;
    logField('ar', { event: 'start' });
    try {
      // Sensors and the tracker come from the same tap the session needs.
      if (tracking.status !== 'on') tracking.start();
      const tracker = tracking.tracker();
      if (!tracker) throw new ArStartError('failed');
      /*
       * The session places the route from where the tracker says the visitor
       * physically is: the check-in point it anchored at, or wherever a walk
       * has carried it since. It used to re-anchor at the distance shown on
       * screen, which may be a walk-through preview - and previewing a stretch
       * of route is not having walked it.
       */
      if (!tracker.isAnchored) {
        logField('ar', { event: 'refused', why: 'no-anchor' });
        setArProblem('Scan a check-in code so the route can be placed from where you stand.');
        return;
      }
      // The published snapshot can lag a tap. Recheck intrinsic position
      // safety; replacing a failed IMU must not erase an off-route/floor hold.
      if (!tracker.canStartPose) {
        setArProblem('Check your location on the map or scan a check-in code before starting AR.');
        return;
      }
      setArStartProgress(tracker.read(performance.now()).progressMeters);
      const handle = await startArGuidance({
        track,
        tracker,
        overlay: overlayRef.current,
        // Finding the floor and tapping Start AR say nothing about building yaw.
        // Until calibrated sign poses are available, accept only a fresh manual
        // alignment. Never substitute the route bearing or walking direction.
        facingDegrees: () =>
          alignedCameraHeading(
            feedRef.current?.read() ?? null,
            anchorRef.current,
            performance.now(),
          ),
        onFrame: (report) => {
          const state = report.recovery ?? (report.aligned ? 'placed' : report.placement);
          if (state !== arState) {
            arState = state;
            logField('ar-state', {
              state,
              seconds: since(),
              floorHits: report.floorHits,
              floorY: report.floorY,
              progress: report.progressMeters,
            });
          }
          if (arOwnerRef.current === owner) setArReport(report);
        },
        onEnd: () => {
          logField('ar', { event: 'ended', seconds: since() });
          // Released on every ending, including the camera view closing first,
          // which bumps the owner; otherwise the hook would report a live
          // position with nothing supplying it.
          tracking.detachPose();
          if (arOwnerRef.current !== owner) return;
          arHandleRef.current = null;
          setArSession(null);
          setArReport(null);
        },
      });
      if (arOwnerRef.current !== owner) {
        await handle.end();
        return;
      }
      arHandleRef.current = handle;
      logField('ar', { event: 'running', seconds: since() });
      tracking.attachPose();
      setArSession(handle);
    } catch (error) {
      if (arOwnerRef.current !== owner) return;
      const reason = error instanceof ArStartError ? error.reason : 'failed';
      logField('ar', { event: 'failed', reason });
      setArProblem(
        reason === 'refused'
          ? 'The immersive session was not allowed.'
          : reason === 'unsupported'
            ? 'This phone does not support immersive guidance with on-screen controls.'
            : 'The immersive session could not start.',
      );
    } finally {
      if (arOwnerRef.current === owner) setArStarting(false);
    }
  };

  const exit = () => {
    arOwnerRef.current += 1;
    void arHandleRef.current?.end();
    arHandleRef.current = null;
    actions.setView(VIEW_TYPE.MAP);
  };

  const snapshot = live ? tracking.snapshot : null;
  // Published by the draw loop, because the phone's yaw is read there.
  const source = arSession ? (arReport?.aligned ? 'ar' : 'off') : drawn.source;
  const needsOrientation = orientationState === 'needs-permission' || orientationState === 'denied';
  const showAlign =
    !arSession && knownStart && orientationState === 'listening' && source !== 'aligned';
  const arActive = arSession !== null;
  /*
   * One place per control, and each keeps its place as the state moves on.
   * Buttons that unmounted when tapped read as broken on a phone: the thing
   * just pressed vanished and something else jumped into its spot. The
   * orientation control walks through its steps in one position, and a control
   * that cannot act says why in its own words rather than silently doing nothing.
   */
  // Plain data here; the handlers stay in the click, because they reach into refs.
  const orientationSlot =
    arSession || orientationState === 'unsupported' || orientationState === 'insecure'
      ? null
      : needsOrientation
        ? { kind: 'enable', label: 'Enable camera orientation', lead: !arAvailable }
        : orientationState === 'requesting'
          ? { kind: 'asking', label: 'Asking for orientation…', lead: false }
          : source === 'aligned'
            ? { kind: 'realign', label: 'Re-align', lead: false }
            : showAlign
              ? { kind: 'align', label: 'I’m facing the corridor', lead: !arAvailable }
              : {
                  kind: 'waiting',
                  label: knownStart ? 'Waiting for orientation…' : 'I’m facing the corridor',
                  lead: false,
                };
  const orientationActs =
    orientationSlot !== null &&
    orientationSlot.kind !== 'asking' &&
    orientationSlot.kind !== 'waiting';
  const trackLeads = !arAvailable && !live && source === 'aligned';
  const remaining = guidance ? guidance.remainingMeters : 0;
  const arrived =
    navStatus === NAV_STATUS.ARRIVED ||
    (arActive ? snapshot?.reason === 'arrived' : (guidance?.atEnd ?? false));
  // What the session needs from the visitor, and the one control that gives it.
  const prompt = arActive
    ? arPrompt({
        report: arReport,
        snapshot,
        arrived: navStatus === NAV_STATUS.ARRIVED,
        floorName,
      })
    : null;
  const promptKind = prompt?.kind ?? null;
  useEffect(() => {
    if (promptKind !== null) logField('ar-prompt', { prompt: promptKind });
  }, [promptKind]);
  /*
   * One line, and only when there is something to do about it. The chips above
   * already say what is known; a paragraph repeating them every frame of a
   * walk is what turned this view into an instrument panel.
   */
  /*
   * What stops the route being placed comes first, then the best way to place
   * it on this phone: an immersive session where there is one, because the
   * phone tracks the floor itself there, and the flat view's steps otherwise.
   */
  const note = arProblem
    ? arProblem
    : live && snapshot?.tier === 'frozen'
      ? 'Position tracking is paused. Check your location on the map before following the floor route.'
      : !knownStart
        ? 'Set your location on the map or scan a check-in code before placing the route.'
        : arAvailable && !arSession && source !== 'aligned'
          ? 'Start AR can find the floor, but cannot yet determine the building’s direction from a sign. For manual alignment, check the map, face along the route and tap “I’m facing the corridor” first.'
          : needsOrientation
            ? 'This phone wants permission before it reports which way it is pointing. Enable camera orientation, then point along the corridor.'
            : orientationState === 'requesting'
              ? 'Asking the phone for its orientation.'
              : orientationState === 'waiting'
                ? 'Waiting for the first orientation reading from this phone.'
                : orientationState === 'paused'
                  ? 'Camera alignment paused. Return here and align again before following the route.'
                  : orientationState === 'stale' || orientationState === 'unavailable'
                    ? 'Orientation signal lost. The floor route is hidden until fresh readings return and you align again.'
                    : // Nothing arriving at all is an orientation problem; a heading
                      // the walk has measured, with no tilt behind it, is the rarer
                      // case where only the tilt is missing, and says so.
                      source === 'off'
                      ? 'Waiting for the phone’s orientation. No floor route is shown without a fresh reading.'
                      : !drawn.tilted
                        ? 'Waiting for the phone’s tilt. The route cannot be laid on the floor without it.'
                        : source === 'assumed'
                          ? 'At your check-in point, face the corridor in the route’s direction, then tap “I’m facing the corridor”.'
                          : !live
                            ? 'Direction follows your phone; position holds until you track your walk.'
                            : null;

  const instructionCard = copy && (
    <div className="camera-preview-instruction">
      <div className="camera-preview-instruction-icon">
        <ManeuverIcon type={copy.step.type} size={28} />
      </div>
      <div className="camera-preview-instruction-copy">
        <div className="camera-preview-lead">{copy.lead}</div>
        <div className="camera-preview-instruction-text">{shortStepTitle(copy.step)}</div>
      </div>
    </div>
  );

  return (
    <div
      className="camera-preview"
      id="camera-preview"
      data-heading-source={source}
      data-facing={drawn.facing ?? ''}
      data-tilted={drawn.tilted ? 'yes' : 'no'}
      data-orientation={orientationState}
      data-ribbon={drawn.points}
      data-callouts={drawn.callouts}
      data-ar={arActive ? 'active' : arSupport === 'yes' ? 'available' : arSupport}
      data-tracking={tracking?.status ?? 'none'}
    >
      {found && !cameraError && (
        <video ref={videoRef} className="camera-preview-video" playsInline muted autoPlay />
      )}
      {found && !cameraError && <canvas ref={canvasRef} className="camera-preview-canvas" />}
      {found && !cameraError && (
        <div ref={calloutLayerRef} className="ar-callouts" aria-hidden="true" />
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
            <MapIcon size={16} /> Choose a destination
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
            <MapIcon size={16} /> Switch to Map View
          </button>
        </div>
      )}

      {found && (
        <header className="ar-top" ref={topRef}>
          {!cameraError && instructionCard}
          <div className="camera-preview-status" role="status">
            <Camera size={13} />
            <strong>{arActive ? 'Immersive guidance' : 'Camera guidance'}</strong>
            <span>
              {arActive
                ? arReport?.aligned
                  ? 'Anchored to your start point'
                  : 'Waiting for placement'
                : 'Not world-anchored'}
            </span>
          </div>
          {!cameraError && (
            <aside className="camera-preview-telemetry" aria-label="Guidance readiness">
              {!videoReady && (
                <div className="not-ready">
                  <Camera size={12} />
                  <span>Video</span>
                  <strong>Starting</strong>
                </div>
              )}
              <div className={live ? undefined : 'not-ready'}>
                <LocateFixed size={12} />
                <span>Position</span>
                <strong>{live ? tierLabel(snapshot) : 'Not tracked'}</strong>
              </div>
              <div className={source === 'assumed' || source === 'off' ? 'not-ready' : undefined}>
                <Compass size={12} />
                <span>Heading</span>
                <strong>{headingLabel(source)}</strong>
              </div>
              {arActive && (
                <div>
                  <Crosshair size={12} />
                  <span>Floor surface</span>
                  <strong>{arReport?.floorY != null ? 'Confirmed' : 'Not confirmed'}</strong>
                </div>
              )}
            </aside>
          )}
          {!cameraError && note && (
            <p className="camera-preview-note" role="status">
              {note}
            </p>
          )}
        </header>
      )}

      {found && !cameraError && drawn.hint && !arActive && (
        <div className={`ar-offscreen is-${drawn.hint}`} role="status">
          <span className="ar-offscreen-arrow" aria-hidden="true">
            {drawn.hint === 'right' ? '›' : '‹'}
          </span>
          <span>Turn {drawn.hint} to find the route</span>
        </div>
      )}

      {found && !cameraError && (
        <canvas ref={miniMapRef} className="ar-minimap" aria-label="Plan of this floor" />
      )}

      {found && (
        <footer className="ar-sheet" ref={sheetRef}>
          {!cameraError && copy && <p className="ar-sheet-instruction">{copy.text}</p>}
          {!cameraError && guidance && (
            <div className="ar-sheet-facts">
              <div>
                <span>Arrival</span> {arrived ? 'Now' : formatMinutes(remaining, walkSpeedMps)}
              </div>
              <div>{arrived ? 'You are here' : `${formatMeters(remaining)} left`}</div>
            </div>
          )}
          <div className="camera-preview-controls">
            {!cameraError && arAvailable && !arSession && (
              <button
                className="camera-preview-control is-primary"
                onClick={startAr}
                disabled={arStarting || arBlocked}
              >
                <Box size={16} />
                {arStarting ? 'Starting AR…' : 'Start AR'}
              </button>
            )}
            {!cameraError && orientationSlot && (
              <button
                className={`camera-preview-control${orientationSlot.lead ? ' is-primary' : ''}`}
                onClick={() => {
                  if (orientationSlot.kind === 'enable') feedRef.current?.request();
                  else if (orientationSlot.kind === 'align') alignNow();
                  else if (orientationSlot.kind === 'realign') unalign();
                }}
                disabled={!orientationActs}
              >
                <Compass size={16} />
                {orientationSlot.label}
              </button>
            )}
            {!cameraError && !arSession && (canTrack || live) && (
              <button
                className={`camera-preview-control${trackLeads ? ' is-primary' : ''}`}
                aria-pressed={live}
                onClick={() => (live ? tracking.stop() : tracking.start())}
              >
                <LocateFixed size={16} />
                {live ? 'Stop tracking' : trackLabel}
              </button>
            )}
            {!cameraError && speechAvailable() && onVoice && (
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
            <button className="camera-preview-control" onClick={exit} id="btn-exit-camera-preview">
              <MapIcon size={16} />
              Exit to plan
            </button>
          </div>
        </footer>
      )}

      {/* Shown over the camera by the immersive session, for as long as it runs. */}
      <div
        ref={overlayRef}
        className={`camera-ar-overlay${arActive ? ' is-active' : ''}`}
        aria-hidden={!arActive}
        data-ar-prompt={prompt?.kind ?? ''}
      >
        {arActive && prompt && (
          <>
            <div className="ar-top">{instructionCard}</div>
            <div>
              <p className="camera-ar-overlay-note" aria-live="polite" hidden={!prompt.note}>
                {prompt.note}
              </p>
              <div className="ar-sheet is-overlay">
                {guidance && (
                  <div className="ar-sheet-facts">
                    <div>
                      <span>Arrival</span>{' '}
                      {arrived ? 'Now' : formatMinutes(remaining, walkSpeedMps)}
                    </div>
                    <div>{arrived ? 'You are here' : `${formatMeters(remaining)} left`}</div>
                  </div>
                )}
                <div className="camera-preview-controls">
                  {prompt.action && (
                    <button
                      className={`camera-preview-control${prompt.leads === 'action' ? ' is-primary' : ''}`}
                      onClick={() => {
                        const kind = prompt.action?.kind;
                        logField('ar-action', { action: kind ?? null });
                        if (kind === 'confirm-arrival') {
                          actions.confirmArrival();
                        } else if (kind === 'confirm-surface') {
                          const accepted = arSession?.confirmSurface() ?? false;
                          logField('ar-floor-confirmation', { accepted });
                        } else if (kind === 'confirm-floor') {
                          // Confirm the storey only; the heading provider must
                          // independently supply direction when placing again.
                          tracking?.confirmFloor();
                          arSession?.realign();
                        } else {
                          arSession?.realign();
                        }
                      }}
                    >
                      {prompt.action.kind === 'realign' ? (
                        <Compass size={16} />
                      ) : (
                        <Check size={16} />
                      )}
                      {prompt.action.label}
                    </button>
                  )}
                  <button
                    className={`camera-preview-control${prompt.leads === 'leave' ? ' is-primary' : ''}`}
                    onClick={() => {
                      logField('ar-action', { action: 'leave' });
                      void arSession?.end();
                    }}
                  >
                    <Square size={16} />
                    Leave AR
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The projected route as a lit ribbon on the floor - a translucent blue bed,
 * bright edges that glow, big chevrons that recede with it - and a ring at
 * the end. Sixty centimetres wide at every depth.
 */
function paintProjection(context, viewport, projection, fadeFrom) {
  const focal =
    viewport.height / 2 / Math.tan((DEFAULT_CAMERA_MODEL.verticalFovDegrees / 2) * (Math.PI / 180));
  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';
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
      // A path about two thirds of a metre across, and never so near that it
      // fills the frame with a slab of colour.
      const half = Math.max(2, Math.min(150, (focal / Math.max(1, point.depthMeters)) * 0.32));
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
    context.fillStyle = 'rgba(10, 101, 219, 0.42)';
    context.fill();
    for (const edge of [left, right]) {
      context.beginPath();
      context.moveTo(edge[0][0], edge[0][1]);
      for (let index = 1; index < edge.length; index += 1) {
        context.lineTo(edge[index][0], edge[index][1]);
      }
      context.shadowColor = 'rgba(142, 197, 255, 0.95)';
      context.shadowBlur = 16;
      context.strokeStyle = GLOW;
      context.lineWidth = 2.5;
      context.stroke();
      context.stroke();
      context.shadowBlur = 0;
    }
  }
  for (const chevron of projection.chevrons) {
    const size = Math.max(5, Math.min(22, chevron.pixelsPerMeter * 0.22));
    context.save();
    context.translate(chevron.x, chevron.y);
    context.rotate(chevron.angleRadians);
    context.beginPath();
    context.moveTo(-size * 0.75, -size * 0.9);
    context.lineTo(size * 0.35, 0);
    context.lineTo(-size * 0.75, size * 0.9);
    context.lineTo(-size * 0.25, size * 0.9);
    context.lineTo(size * 0.85, 0);
    context.lineTo(-size * 0.25, -size * 0.9);
    context.closePath();
    context.shadowColor = 'rgba(142, 197, 255, 0.9)';
    context.shadowBlur = 12;
    context.fillStyle = 'rgba(223, 240, 255, 0.95)';
    context.fill();
    context.restore();
  }
  if (projection.destination) {
    const radius = Math.max(8, Math.min(44, 420 / Math.max(1, projection.destination.depthMeters)));
    context.save();
    context.shadowColor = 'rgba(142, 197, 255, 0.9)';
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(projection.destination.x, projection.destination.y, radius, 0, Math.PI * 2);
    context.strokeStyle = GLOW;
    context.lineWidth = 4;
    context.stroke();
    context.beginPath();
    context.arc(projection.destination.x, projection.destination.y, radius * 0.55, 0, Math.PI * 2);
    context.fillStyle = 'rgba(142, 197, 255, 0.35)';
    context.fill();
    context.strokeStyle = CREAM;
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }
  // The near end of the ribbon would run under the sheet: let it go before it gets there.
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
