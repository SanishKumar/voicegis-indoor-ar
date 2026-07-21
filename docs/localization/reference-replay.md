# Synthetic localization replay report

## Scope

This is a deterministic software regression fixture. It is **not** a measured indoor-localization result.

The recording simulates a five-metre eastbound walk along the ground-floor corridor in the synthetic reference building. Observations include an explicit initial fix, step displacement, heading, and one synthetic visual-anchor correction. No camera frames are stored.

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

- Observations: 7
- Ground-truth checkpoints: 3
- Quality frames: 4 high, 3 degraded, 0 lost
- Median horizontal checkpoint error: 0.053 m
- p95 horizontal checkpoint error: 0.056 m
- Floor accuracy: 1.0
- Route matches accepted: 7
- Route matches rejected: 0

These small errors are expected because both the simulated observations and checkpoints follow the same constructed straight path. They must not be quoted as device, venue, or real-world accuracy.

## Filter contract

The current core publishes:

- position, elevation, velocity, heading, and active floor;
- a 5×5 covariance matrix over horizontal position, velocity, and heading;
- position and heading standard deviation;
- contributing observation sources and last correction time;
- explicit `high`, `degraded`, or `lost` quality.

The matcher retains each raw estimate and projects it only to a same-floor route segment inside an uncertainty-aware gate. Lost quality, wrong floors, excessive distance, and implausible backward progress produce explicit rejection reasons; a nearby route never upgrades localization quality.

The filter rejects a stream that does not begin with an initial fix or moves backward in time. Quality becomes lost when uncertainty or correction age crosses configured limits.

## Evidence still required

- Real sensor adapters and timestamp characterization
- Surveyed ground-truth checkpoints
- Multiple devices, routes, floors, walking speeds, and carrying positions
- Relocalization recovery timing
- Median and p95 reports from physical walks
