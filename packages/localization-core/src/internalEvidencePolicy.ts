import type { CaptureSensorProfile, SurveyMethod } from './captureStream';

/**
 * Evidence policy. Internal on purpose.
 *
 * This module is not re-exported from the package barrel, so the rules that
 * decide whether a walk may be published cannot be reached — or edited — from
 * outside. `as const` is a compile-time assertion only: an exported object is
 * still writable at runtime, and reassigning one field of the sensor model was
 * enough to make a refused capture publishable.
 */

/**
 * The one sensor model current processing can interpret.
 *
 * Yaw is read from the gyroscope's Z component, which is the world vertical
 * only when the samples are already resolved into the world frame. Browser APIs
 * report in the device frame, so a browser capture declaring the world frame
 * has been transformed by something unrecorded or simply renamed.
 *
 * This native path is presently test-only: no production native adapter exists,
 * and nothing records which transform produced the world frame, which axes it
 * used, or which direction it calls positive yaw. Declaring `native/world/deg/s`
 * therefore still passes this gate without proving anything, and it stays that
 * way until the orientation and provenance slice defines those terms.
 */
const EVIDENTIAL_SENSOR_MODEL = Object.freeze({
  api: 'native',
  frame: 'world',
  gyroscopeUnits: 'deg/s',
} as const);

export function isEvidentialSensorModel(sensors: CaptureSensorProfile) {
  return (
    sensors.api === EVIDENTIAL_SENSOR_MODEL.api &&
    sensors.frame === EVIDENTIAL_SENSOR_MODEL.frame &&
    sensors.gyroscopeUnits === EVIDENTIAL_SENSOR_MODEL.gyroscopeUnits
  );
}

/** Read-only view, for reports and diagnostics. */
export function evidentialSensorModel(): Readonly<{
  api: string;
  frame: string;
  gyroscopeUnits: string;
}> {
  return EVIDENTIAL_SENSOR_MODEL;
}

/**
 * Longest stretch of inertial silence inside an evidence window.
 *
 * Gaps are clipped to the window, so a long silence that only clips its edge
 * contributes just the overlapping milliseconds. Silence before the first
 * sample and after the last one counts too: a window with no samples at all is
 * entirely a gap, and a single sample leaves silence on both sides.
 */
export function worstCoverageGapMs(
  sampleTimesMs: number[],
  windowStartMs: number,
  windowEndMs: number,
) {
  if (windowEndMs <= windowStartMs) return 0;
  const inside = sampleTimesMs
    .filter((time) => time >= windowStartMs && time <= windowEndMs)
    .sort((left, right) => left - right);
  if (inside.length === 0) return windowEndMs - windowStartMs;

  let worst = inside[0] - windowStartMs;
  for (let index = 1; index < inside.length; index += 1) {
    worst = Math.max(worst, inside[index] - inside[index - 1]);
  }
  return Math.max(worst, windowEndMs - inside[inside.length - 1]);
}

/**
 * Survey methods whose marks may back a published figure.
 *
 * Written as a value predicate rather than a set. A `ReadonlySet` is a
 * compile-time assertion only, and `Object.freeze` does not disable `add`, so
 * an exported set could be widened at runtime — adding `estimated` was enough
 * to turn a refused walk into a published metric.
 */
export function isPublishableSurveyMethod(method: SurveyMethod) {
  return (
    method === 'tape-measure' || method === 'laser-distance' || method === 'total-station'
  );
}

/**
 * Coarsest survey a published mark may rest on. Error is measured in metres, so
 * a mark known only to half a metre cannot support the claim.
 *
 * One literal, in one place. The predicate and the reported threshold were two
 * independent `0.25`s, which is two things that can disagree about the policy a
 * sealed artifact fingerprints.
 */
const MAX_PUBLISHABLE_SURVEY_ACCURACY_METERS = 0.25;

export function isPublishableSurveyAccuracy(expectedAccuracyMeters: number) {
  return expectedAccuracyMeters <= MAX_PUBLISHABLE_SURVEY_ACCURACY_METERS;
}

/** Read-only view of the accuracy threshold, for reports. */
export function maxPublishableSurveyAccuracyMeters() {
  return MAX_PUBLISHABLE_SURVEY_ACCURACY_METERS;
}

/** Every survey method the capture schema defines, publishable or not. */
const ALL_SURVEY_METHODS: readonly SurveyMethod[] = [
  'tape-measure',
  'laser-distance',
  'total-station',
  'estimated',
];

/**
 * The publishable methods, as a list, for recording in a sealed artifact.
 *
 * Computed by asking the predicate rather than repeating its contents. A second
 * hand-maintained list is a second thing that can disagree with the authority,
 * and an artifact that fingerprints the wrong policy is worse than one that
 * fingerprints none.
 */
export function publishableSurveyMethods(): SurveyMethod[] {
  const publishable: SurveyMethod[] = [];
  for (let index = 0; index < ALL_SURVEY_METHODS.length; index += 1) {
    const method = ALL_SURVEY_METHODS[index];
    if (isPublishableSurveyMethod(method)) publishable.push(method);
  }
  return publishable;
}

/**
 * The version of the rules that decide publishability.
 *
 * Bump this whenever a policy value or predicate changes meaning. The artifact
 * records both this and the resolved values, so a reader can tell a policy
 * change from a configuration change without diffing every field.
 */
export const EVIDENCE_POLICY_VERSION = '0.1.0' as const;
