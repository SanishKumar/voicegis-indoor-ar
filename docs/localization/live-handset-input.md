# Live handset input boundary

Phase 2 slice G2, 16 September 2026. This is an operator diagnostic, not a
validated positioning system. The [checkpoint panel](operator-session-harness.md)
can opt in to motion and tilt input; it has no independent travel-heading source
and never forwards those uncalibrated samples as qualified motion or Visitor
progress. All input is in memory, separate from the walk recorder and evidence.

## Permission and lifetime

`startHandsetSubscription` is called directly from the Enable button after the
session has created an acquisition owner. It checks secure context, foreground
visibility and both event constructors before prompting. Where permission methods
exist, both requests start synchronously in that user gesture. Neither sensor
listener attaches until both requests resolve successfully. A disposer exists
immediately, including while permissions are pending.

Disable, stop, unmount, owner replacement, hidden and pagehide dispose listeners;
late grants cannot revive them. Optional accelerometer/gyroscope permission
queries monitor revocation where exposed. Unsupported queries are not interpreted
as grants. Lack of a prompt or a successful grant does not establish sensor
presence, complete data or usable localization. Foreground return is not recovery.

The API assumptions follow the [W3C Device Orientation and Motion specification](https://www.w3.org/TR/orientation-event/):
secure-context access, separate motion/orientation permission entry points, and
rotation-rate alpha/beta/gamma as Z/X/Y axes. Browser support and physical timing
still require handset trials. Relative orientation alpha is not venue heading.

## Occurrence and ownership

`LiveHandsetInput` binds to the exact current `LiveObservationLease`, not a copy
of its fields. `ownsAcquisition` checks object identity without making a frame
or renewing freshness. Every delivery also reads the live session and checks
generation, identity, lifecycle and time. A replaced or stopped owner loses its
heading and cannot affect the new acquisition.

Event `timeStamp` and consumer `performance.now()` must share a monotonic
millisecond origin. The adapter does not replace occurrence with receipt time or
normalize an unknown epoch. Events older than the acquisition boundary are
ignored; malformed, future, duplicate, regressing or excessively late input is
refused. Motion and orientation have independent occurrence watermarks.

The current experimental software limits are:

| Check | Limit | Enforcement |
| --- | --- | --- |
| Delivery age | At most 500 ms | Each channel's occurrence versus receipt |
| Paired tilt age | At most 100 ms | Tilt must precede or equal the motion occurrence |
| Motion continuity | Less than 1,000 ms | Complete-motion gaps, including the first sample after calibration |

These are conservative diagnostic policies, not measured latency distributions,
battery recommendations, device admission rules or accuracy guarantees. The
underlying session also retains its separate 1,500 ms motion deadline.

## Reduction and refusal

A complete sample needs finite acceleration-including-gravity and all three
rotation rates, plus finite, fresh beta/gamma tilt. Alpha and compass/absolute
flags never supply travel heading. Gyro rates use the existing handset profile
and tilt-aware projection before entering the existing dead-reckoning integrator.

An incomplete sample or continuity loss clears cached tilt, heading and partial
motion, and latches a guidance fault. Fresh raw pairs can still update readiness
counts, but cannot clear that fault or renew the session. Explicit checkpoint
recovery creates a fresh lease and reducer. Orientation-only events and watchdog
reads do not generate motion frames; no timer extrapolates position.

The reducer's `calibrate` entry point is reserved for a future independently
measured, venue-bound pose producer. The core checks the calibration declaration;
provenance is still a caller assertion, not measured evidence. The operator UI
never calls it. Only synthetic unit inputs exercise calibrated forwarding.

Calibration cannot arrive behind already consumed input. It clears cached tilt
and unfinished steps; unlocated steps are never replayed later. Observed stride
intervals crossing acquisition, calibration or the preceding stride are suppressed
instead of being shortened or assigned a fabricated start. Accepted calibrated
motion carries either that observed stride or explicit `stride: null`. Any core
refusal clears heading and latches recovery. Calibrated watchdog reads also detect
silent tilt or motion without inventing a heartbeat.

## Verification and remaining work

The reducer has 22 synthetic tests and the subscription has 12 lifecycle/permission
tests. The 27 harness tests include consent, cancellation, late results, replacement
and Visitor isolation. Controlled desktop/mobile Chromium tests exercise the
production operator build, including denial/retry and reachable 320 px controls.
They are not physical iOS/Android sensor tests or mobility validation.

Before enabling qualified observations in the panel: establish a measured
independent travel-axis source with a defensible venue frame and provenance;
measure actual occurrence/receipt lag and missing-channel behavior; test
stop/restart, device poses and supported mobility patterns on physical handsets.
Raw capture still has no versioned independent calibration/pose event. Do not
invent that evidence or promote route/compass/QR orientation to fill the gap.

Whole-venue off-route evidence, verified connectors, accessible movement models
and predeclared venue pilot thresholds remain release gates for automatic Visitor
navigation. No capture, recording, replay, evidence or venue artifact changed here.
