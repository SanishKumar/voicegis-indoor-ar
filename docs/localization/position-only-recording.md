# Position-only checkpoints and recording 0.2

Phase 2 slice C, 12 September 2026. Software contracts and synthetic tests only;
this does not enable Visitor tracking or establish real-device accuracy.

## What changed

QR and NFC decoding identifies a checkpoint position and floor. The marker's
authored `headingDegrees` describes the marker, not the handset or direction of
travel. `CheckpointAdapter` no longer reads it, emits a heading correction, or
seeds the inertial integrator. The first fix has explicit null heading and
heading accuracy; subsequent scans produce position and floor observations only.

Recording version **0.2.0** distinguishes three directional observations:

| Observation | Meaning |
| --- | --- |
| `heading-calibration` | Independent, declared travel-axis direction in the exact venue's filter-local frame |
| `heading` | An inertial update after calibration; never a source of initial direction |
| `heading-unavailable` | Direction is unknown; any previous calibration is invalidated for further updates |

A calibration carries its source, angle, uncertainty, reference, axis, building
ID, package hash and provenance ID. Only explicit synthetic replay declarations
or visual-pose declarations are accepted; `manual-anchor` and `inertial` cannot
calibrate. Bare recording declarations are not authenticated or surveyed evidence.
Camera-forward, device-top, magnetic-north and true-north values cannot simply be
retagged as travel direction. The coordinate bridge from slice B is still not
connected to captured positions.

The filter also enforces this boundary when called directly. Its constructor
accepts an explicit frame identity separately from tuning; without one it can
only retain position with unknown direction. The identity is copied, not retained
as caller-owned mutable state. Initial fixes carrying old numeric heading fields
are rejected, even outside replay.

## Unknown does not mean north

The integrator defaults to unknown, not zero degrees. Raw gyroscope rates can
measure a change of orientation but cannot establish its starting direction.
Unseeded integration emits `heading-unavailable` observations on the existing
diagnostic cadence. This preserves causal estimate timestamps for ground-truth
alignment without inventing a compass observation.

The filter exposes unknown heading and heading uncertainty as `null`. It keeps a
finite internal matrix placeholder, but never uses that placeholder to move the
position. An uncalibrated stride is retained in the recording; its displacement
direction is unknown, velocity stays zero, and position uncertainty grows by the
stride length squared plus its variance. This conservative software rule is not
a field-calibrated error distribution. A later calibration does not retroactively
apply earlier strides.

Position fixes can still correct position and floor. They do not replace an
independently established heading. Runtime guidance is frozen while heading is
unknown, and heading loss does not erase an existing lost/relocalizing state.

## Versioning and existing files

- Raw **Capture Stream 0.2.0 remains unchanged and readable**. It has no independent
  travel-heading calibration event; decoded scans and raw orientation do not fill
  that gap. Derivation produces position-only recording 0.2 observations.
- **Recording 0.1.0 is refused by current replay**, with an explanatory error.
  Do not change its version string or promote its embedded heading into a new
  calibration. Re-derive from the original raw capture where available. Without
  that capture, retain the original file and use its original build for historical
  diagnosis; trustworthy calibration cannot be recovered from a number alone.
- The bundled reference recording is an explicitly authored **synthetic 0.2
  fixture**, including a separately labelled eastbound travel-axis calibration.
  Its regenerated report has eight observations and one initial frozen frame.
  It remains `unofficial-recording`, with no accuracy figures.
- Evidence processor **0.4.0** and policy **0.3.0** withhold all accuracy figures
  from raw capture 0.2. An otherwise eligible capture reports
  `unverified-heading`; existing unsupported-sensor, incomplete, interrupted,
  invalid-state and ground-truth/manifest refusals retain precedence.
- Sealing a refused result still succeeds and records why it has no figure.
  Verification refuses a fabricated `ok` even with a recomputed hash. Earlier
  processor/policy artifacts need their original build; do not relabel them.
  No previous capture or field artifact was overwritten in this slice.

The retained checkpoint `headingAccuracyDegrees` tuning is an unused legacy
fingerprint field, not a measurement of the phone. No sensor model was newly
admitted, and no camera frames or new personal data are recorded.

## Verification and remaining work

The five initial QR/NFC/derivation/evidence regressions failed against the actual
unchanged code before implementation. Additional tests cover position retention,
uncertainty, later calibration, invalidation, wrong-frame/source/axis/uncertainty
refusals, legacy recording rejection and frozen runtime recovery. Direct-filter
bypasses were also reproduced before closing them. Existing motion and bounds
fixtures now declare their synthetic calibration separately, retaining the
original displacement, numeric-bound and tampering assertions.

The subsequent [interrupted-IMU continuity slice](imu-continuity.md) invalidates
stale integration across missing rates, material sample gaps and lifecycle
boundaries (processor 0.5 / policy 0.4). A versioned raw calibration/pose capture event, with
real-device timing and surveyed alignment provenance, is also required before
accuracy reporting can resume. That capture-schema design, live watchdogs,
matching/floor-transition gates and physical pilot validation remain separate
work. None is implied by a passing synthetic replay.
