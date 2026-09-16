# Live session freshness and explicit reacquisition

Phase 2 slice F, 15 September 2026. `LiveLocalizationSession` is an in-memory
controller around the existing filter, route matcher and runtime. It is exported
from localization-core, but **is not connected to Visitor**.
Automatic instructions, arrival and rerouting remain disabled.

Slices G1/G2 exercise this controller in an operator-only
[diagnostic panel](operator-session-harness.md). It verifies the package/route
boundary and owns visibility/watchdog cleanup plus optional handset listeners.
The [input adapter](live-handset-input.md) has a synthetic-tested calibrated
forwarding path, but the panel supplies no travel calibration or qualified motion
and never changes Visitor progress.

## Session ownership

Construct one session for an exact session ID, building ID, package hash and
route revision. Supply the verified package's anchors, explicit floor elevations
and route segments in **filter-local metres**, not Visitor plan coordinates.
The controller snapshots those values. It does not verify the package hash,
survey a sign, reflect geometry, or prove that a supplied route respects closures
or accessibility. Those remain responsibilities of the verified venue/route owner.

Changing the route, accessibility profile, closure policy or package requires
stopping the old session and creating a new one with the appropriate identity.
The old instance cannot restart. View switching is not a session replacement:
2D, 3D and camera presentation should share the same owner and snapshot.

`beginAcquisition(nowMs)` creates an object-identity observation lease. Capture it
before requesting permission, starting a scan, or starting sensor work. Do not
replace a captured lease with the latest one when an asynchronous result arrives.
Copied lease fields, another instance's lease, and retired leases cannot submit
observations. Identity fields are diagnostic context, not cryptographic credentials.

`ownsAcquisition(lease)` checks this exact object identity without consuming time
or renewing freshness. An adapter can reject a copied token at construction;
it must still read/check the session and occurrence timestamps on delivery.

## Recovery sequence

1. The owner checks foreground visibility, consent and capability, then explicitly
   begins acquisition. This freezes guidance and retires previous callbacks,
   filter state and heading. Merely becoming visible must not call it automatically.
2. `reacquire(lease, scan, nowMs)` resolves the fresh QR/NFC payload against the
   session's anchor snapshot. Unknown/ambiguous payloads, transport mismatches,
   missing elevations, and rejected route matches do not commit a new fix.
3. An accepted checkpoint atomically establishes position, floor and a new route
   cursor. It is position-only: guidance remains frozen. A second scan cannot
   reset that cursor without another explicit acquisition.
4. `calibrate` requires fresh, independent travel-axis calibration for the exact
   venue frame. Only the existing visual-anchor calibration declaration is
   accepted on this live boundary; replay/manual-anchor tags are refused.
   A QR's authored orientation is never used as phone heading.
5. A fresh qualified complete motion frame is also required. Only then can the
   existing runtime and current route match permit active/caution guidance.

An upper-floor checkpoint can explicitly reacquire that floor. This does not
prove the person used a particular lift/stair or traversed a permitted connector.
There is no generic position-fix/source-history bypass into this session.

Calibration provenance is still a **caller assertion**, not a measured pose or
an authenticated capture artifact. No browser currently supplies this controller
with validated independent alignment. The synthetic tests declare it explicitly;
they are not grounds to relabel a compass or QR scan as calibration.

## Clocks, silence and motion intervals

All occurrence timestamps and `nowMs` use one monotonic millisecond origin.
Do not mix `Date.now()`, event timestamps from a different epoch, or a replay
timeline. Invalid/regressing consumer clocks freeze the session and throw.

Default software policy:

| Boundary | Default | Meaning |
| --- | --- | --- |
| Motion timeout | 1,500 ms | Freeze at or beyond the deadline from the last qualified motion occurrence; before the first one, from the checkpoint occurrence |
| Delivery age | 500 ms | Reject older input, future input and events before the acquisition boundary |
| Diagnostic publisher | 250 ms | Optional snapshot polling, not a sampling-rate or battery recommendation |

The timeout is checked on every read and **before** accepting new input. A sample
arriving after a silent gap cannot renew the lease retroactively. Calibration and
scans are not motion heartbeats; receipt time does not replace occurrence time.
Duplicate/out-of-order motion does not advance displacement or refresh its clock.

`LiveMotionFrame` is a typed adapter contract, not raw DeviceMotion or compass
data. The producer must supply a qualified complete motion sample, including a
travel-frame heading and either an observed stride or explicit `stride: null`.
It must not manufacture heartbeat frames from timers or compass-only events when
the accelerometer has stopped. Null heading reports loss and retires the lease.
Incomplete/invalid data freezes guidance; numeric/timing refusals stay explicit.

Stride intervals cannot cross checkpoint acquisition, heading calibration, or the
end of the preceding stride. The adapter must also reset its integrator at those
boundaries. Each admitted stride is applied once; unlocated strides are not
replayed after calibration. No position mean is extrapolated on reads/timer ticks.

Freshness is not sufficient quality: lost filter quality and **any** rejected
route match latch recovery as well. A plausible subsequent frame cannot silently
clear either. Defaults are conservative software policy, not measured handset
latency, walking speed, localization accuracy or safe-clearance guarantees.

## Publication and cleanup

`read(nowMs)` returns detached snapshots. A frozen snapshot exposes
`progressMeters: null`; its retained estimate/route match/checkpoint are explicitly
last-known diagnostics, not a current position. `accepted` input results are not
arrival or maneuver-advance signals; the snapshot's guidance gate still applies.

`watchLocalizationSession` is an optional diagnostic interval publisher. It emits
without sensor callbacks, returns an idempotent disposer, and retires its timer
when it observes a stopped session or a callback/read throws. The owner must
dispose it on teardown and deliver hidden/permission-denied/sensor-unavailable/
floor-change interruptions immediately. Stopping does not release cameras or
listeners: the owner still owns those resources.

A browser can suspend timers and rendering. No JavaScript watchdog runs while
the process cannot execute. On return, the owner must process lifecycle state and
read the current snapshot before presenting guidance, not restore a cached active
snapshot. The deterministic controller does not install browser listeners itself.

## Verification and compatibility

The 13 initial tests failed because the new session API did not yet exist; this
is feature-absence proof, **not** a claim of 13 reproduced behavioral defects in
the old replay code. Six follow-up regressions reproduced defects during session
implementation before correction: pre-acquisition and overlapping strides,
missing stride input, stopped-session timer cleanup, calibration returning success
after route rejection, and timer cleanup after a consumer exception.

The resulting 62 synthetic tests cover lifecycle/lease ownership, silent expiry,
input age, motion intervals, same-time duplicates, floor reacquisition, matching,
quality loss, calibration qualification, numeric validation and mutation isolation.
See the visitor plan for complete gate results. No field accuracy was measured.

This is separate from replay/evidence. Processor/policy remain **0.6.0/0.4.0**;
capture/recording remain **0.2.0/0.2.0**. No report, recorded walk or venue artifact
was regenerated in slice F. The existing replay runtime is still observation-driven;
it is not made wall-clock-driven by adding this live controller.

The operator harness now owns opt-in motion/tilt delivery and lifecycle cleanup.
Next: establish independently measured calibration and physical handset timing
before enabling qualified input in that panel. Keep unavailable calibration
explicit and test recovery without granting public progress.
Whole-venue off-route evidence, surveyed calibration, connector verification,
real-device/mobility trials and pilot release thresholds remain required.
