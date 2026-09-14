# Interrupted IMU continuity

Phase 2 slice D, 12–14 September 2026. This is deterministic replay and recorder
lifecycle work, not live Visitor tracking or proof of handset accuracy.

## The boundary

| Input                                                                      | Direction                                         | Step detector                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Missing/non-finite heading rate                                            | Immediately unknown, before any same-sample step  | Valid acceleration may still count an unlocated stride                               |
| Sample gap at or above the continuity limit                                | Unknown; no turn integrated across the gap        | Discard baseline, unfinished peak and previous stride time; seed from resumed sample |
| Duplicate sample timestamp or unusable acceleration magnitude              | Unknown; drop the sample                          | Discard motion history; require a fresh sample                                       |
| Background/foreground, sensor interruption/resume, permission denial/grant | Unknown at the lifecycle event                    | Reset on both sides of the interruption                                              |
| Explicit independent recalibration                                         | New direction applies from the next sample onward | Clear pre-calibration intervals and unfinished peaks                                 |

`maximumSampleGapMs` is a separate, fingerprinted tuning field, defaulting to
1,000 ms with an inclusive boundary. This matches the existing material-gap
evidence threshold; it is not a measured safe navigation deadline. It must be
finite and positive. `maximumStepIntervalMs` still caps reported stride duration
and does not authorize integrating a missing interval.

Invalid/regressing timestamps are rejected before state changes. Resets preserve
observation sequencing, cumulative step counts, unresolved-rate counts and a
non-regressing input-time watermark. Resumed rates describe relative rotation;
they cannot restore absolute direction. QR/NFC scans remain position-only and
cannot calibrate heading or resume suspended sensors.

## Replay and handset recording

Capture derivation consumes lifecycle events in their existing causal order.
Background, sensor interruption and permission denial are independent gates:
foregrounding cannot clear the other two. Samples recorded while any gate is
closed remain in the raw capture, but cannot derive motion. A boundary sharing
a millisecond with a sample retains capture sequence order; replay does not
retroactively cancel a step preceding the boundary. Source captures are not
rewritten. Normal session start/end remain structural delimiters.

The handset recorder now records visibility boundaries and ignores sensor
callbacks while hidden. It clears cached tilt on both visibility transitions;
after returning, a motion sample has null orientation until fresh tilt arrives.
The boundary also rejects delayed orientation callbacks stamped before resume;
arrival after resume does not make pre-pause tilt fresh.
An invalid orientation event also clears previous tilt. Stop and unmount remove
the motion, orientation and visibility listeners. Concurrent start taps share
one permission request, and a grant after unmount cannot start a hidden recorder.

The filter/runtime tests verify that an unknown-direction stride does not move
the position mean, has zero directional velocity, increases uncertainty and
freezes guidance. Recalibration does not replay missing motion. No rendering,
route progress, floor selection or Visitor permissions were changed.

## Compatibility

- Capture Stream and Recording remain **0.2.0**; no capture or venue is migrated.
- Evidence processor is **0.5.0**, because identical raw captures can now derive
  different observations. Artifacts carry the resolved continuity limit, and
  the decoder refuses non-positive limits as well as missing/non-finite ones.
- Policy is **0.4.0**: recorded permission denial now joins backgrounding and
  sensor interruption as a reason to withhold interrupted-walk evidence.
- Raw capture 0.2 still lacks independent travel calibration. Otherwise eligible
  walks remain `unverified-heading`; browser/device-frame captures remain
  `unsupported-sensor-model`. No accuracy figures have been newly admitted.
- Older processor/policy artifacts require their original build. Do not change
  version tags or overwrite historical artifacts to make verification pass.

## Deliberately still open

This reducer reacts to an incoming sample or recorded lifecycle boundary. It is
not a live wall-clock watchdog: total silence must be detected by a future live
session, which must freeze guidance before another sample arrives.

The browser recorder measures tilt lag, with no invented default staleness
limit. Partial raw motion events are still rejected and counted, not serialized
as nullable vectors or per-sample interruption events. Short runs of rejected
raw samples therefore cannot be reconstructed from capture 0.2. A future
device-frame admission/capture contract must address this, permission revocation
signals, independent orientation-channel silence and real device timing. The
current device-frame refusal remains essential.

Next software slice: route-matching forward-jump, ambiguity and floor-transition
gates. Independently surveyed calibration/pose provenance, raw capture evolution,
live observation-age policy and real iOS/Android/mobility testing remain required
before automatic Visitor progress. These synthetic tests do not certify any
stride model, sensor accuracy, safe deadline or real-building route.

## Verification

All 19 initial core regressions failed against the actual `3bb408c` implementation
before restoration of the fix. All three initial handset/component regressions
also failed before their fixes. Added coverage includes recovery, independent
suspension gates, same-millisecond ordering, unlocated strides, cleanup, late
permission grants and artifact decoding. The two non-positive artifact-limit
tests first reproduced a hole in this slice's initial decoder implementation.
A queued pre-resume orientation regression also failed against the initial
visibility fix, before adding the timestamp boundary.

Production-browser coverage dispatches explicitly synthetic motion, orientation
and visibility events and validates the downloaded capture through the real
capture parser. Both desktop and mobile tests failed against the actual prior
handset/recorder implementation: the exported background/foreground boundaries
were missing. This does not establish actual background delivery or iOS permission
behavior. Final gate results are recorded in the visitor plan.
