# ADR 0005: Build localization as a replayable estimate pipeline

- Status: accepted
- Date: 2026-07-22

## Context

A live position dot can look convincing while hiding timestamp errors, uncertainty growth, or nondeterministic sensor handling. Physical benchmarks and relocalization logic cannot be reproduced if localization exists only inside a camera render loop.

## Decision

Localization begins as a pure observation-to-estimate pipeline. Recordings contain typed, ordered observations, package identity, device metadata, privacy flags, and ground-truth checkpoints. Camera frames are excluded by default.

The first estimator uses a small covariance-aware pedestrian filter over horizontal position, velocity, and heading. It publishes floor, elevation, covariance, source history, correction age, and explicit high/degraded/lost quality. The same observation stream must replay to identical estimates and evaluation metrics.

Synthetic traces are labeled as regression fixtures. Real accuracy claims require surveyed checkpoints, device and route metadata, and reproducible median/p95 reports.

## Consequences

- Filter and quality-state failures can be tested without device hardware.
- Future sensor adapters write observations rather than mutating UI position directly.
- Navigation can freeze guidance based on a declared lost state.
- The initial filter is not yet a production EKF, route-constrained matcher, or evidence of physical accuracy.
