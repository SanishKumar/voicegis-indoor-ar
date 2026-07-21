# ADR 0006: Keep route map matching gated and non-destructive

- Status: accepted
- Date: 2026-07-22

## Context

Snapping a noisy estimate to the nearest route line can make a navigation display look stable while concealing a wrong floor, large position error, backward jump, or fully lost localization state.

## Decision

Map matching is a derived replay result, not a mutation of the raw filter estimate. Every frame retains the raw position and records either a matched position or an explicit rejection reason.

Candidates are limited to route segments on the estimated floor. The acceptance gate grows with position uncertainty but has a fixed maximum. Matching rejects lost quality, missing routes, wrong floors, candidates outside the gate, and progress that moves backward beyond a bounded jitter allowance.

The matcher never changes a lost estimate to high or degraded quality merely because route geometry is nearby.

## Consequences

- Raw and matched trajectories can be compared during replay.
- A visually plausible snap cannot hide a lost localization state.
- Progress hysteresis is deterministic and unit tested.
- Vertical transitions and route-segment construction still need richer physical-walk evidence.
