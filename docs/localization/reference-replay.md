# Synthetic localization replay report

## Scope

This is a deterministic software regression fixture. It is **not** a measured indoor-localization result.

The recording simulates a five-metre eastbound walk along the ground-floor corridor in the synthetic reference building. Recording 0.2 includes a position-only initial fix, separately declared synthetic travel-axis calibration, step displacement, inertial heading and one synthetic visual-anchor correction. No camera frames are stored.

## Reproduce

```bash
npm run replay:reference
npm run replay:check
```

Inputs and generated evidence:

- `recordings/reference-corridor-walk.json`
- `recordings/reference-corridor-walk.report.json`

The report is regenerated from the observation stream and compared byte-for-byte in the repository quality gate.

## Current result

- Observations: 8
- Ground-truth checkpoints: 3
- Quality frames: 5 high, 3 degraded, 0 lost
- Horizontal errors and floor accuracy: withheld (`null`)
- Route matches accepted: 8
- Route matches rejected: 0
- Runtime frames: 1 initializing, 4 tracking, 3 degraded, 0 lost/relocalizing
- Guidance-frozen frames: 1

The public replay reports `unofficial-recording` and withholds aggregate and
per-checkpoint errors. A bare observation stream has no independently surveyed
provenance. Earlier numeric results in this document were synthetic calculations,
not device, venue, or real-world accuracy.

Processor 0.4 / policy 0.3 additionally withhold accuracy from raw capture 0.2,
which has no independent calibration event. See the
[position-only recording migration](position-only-recording.md). Numeric heading
and its uncertainty are null until calibration; the initial frozen frame is
deliberate. Old recording 0.1 inputs cannot be fixed by changing the version tag.

## Filter contract

The current core publishes:

- position, elevation, velocity, heading, and active floor;
- a 5×5 covariance matrix over horizontal position, velocity, and heading;
- position and heading standard deviation;
- contributing observation sources and last correction time;
- explicit `high`, `degraded`, or `lost` quality.

The matcher retains raw estimates and projects only inside a same-floor uncertainty
gate. Slice E adds ambiguity, bounded forward progress, connectivity and pending-floor
refusals; a route-scoped high-water mark prevents backward jitter ratcheting.
Rejected projections freeze route-bound runtime guidance without upgrading or
rewriting the raw estimate. See [the limits and contract](route-matching-safety.md).

Runtime state is distinct from filter quality. Lost quality freezes guidance, and a later plausible estimate enters `relocalizing` rather than silently resuming. A recent trusted visual or manual anchor must explicitly confirm recovery; that transition records anchor identity and recovery duration.

The filter rejects a stream that does not begin with an initial fix or moves backward in time. Quality becomes lost when uncertainty or correction age crosses configured limits.

### Step-driven motion (processor 0.3.0)

Each step applies its full displacement exactly once. Heading-only and floor
observations do not translate the horizontal position; a position fix can correct
it but cannot establish continued walking. No position is extrapolated across an
observation gap. Velocity describes a step's interval only; other frames return
zero, which means no velocity observation rather than proven physical stillness.

The existing covariance-aging model and quality thresholds are retained. Holding
the position mean does not hold uncertainty or renew the last position correction.
The filter is observation-driven: it does not have a wall-clock watchdog while
no events arrive. A future live adapter must freeze guidance on stale input or
interruption immediately; this change alone is not that adapter.

`motionAccounting.test.ts` includes deterministic stop/turn/gap, cadence,
correction and IMU-to-replay regressions. All 15 cases failed on the prior filter.
Subsequent slices define the coordinate/heading boundary, position-only recording
and [interruption resets](imu-continuity.md), followed by bounded route/floor safety
under processor 0.6 / policy 0.4. Live silence handling, raw calibration provenance
and verified connector traversal remain open. These regressions do not validate
phone carriage, wheelchair motion or sensor accuracy.

## Evidence still required

- Timestamp characterisation on real hardware. A browser sensor adapter now
  exists (`src/capture/handsetCapture.ts`, driven from `#/recorder`) and reports
  the lag between the orientation and inertial channels, but no distribution has
  been recorded from a real handset, and a device-frame capture is refused as
  evidence until one has been.
- Surveyed ground-truth checkpoints
- Multiple devices, routes, floors, walking speeds, and carrying positions
- Relocalization recovery timing
- Median and p95 reports from physical walks
