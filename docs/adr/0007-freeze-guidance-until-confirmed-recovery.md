# ADR 0007: Freeze guidance until relocalization is explicitly confirmed

- Status: accepted
- Date: 2026-07-22

## Context

After localization is lost, a filter can later emit a plausible high-quality estimate that is nevertheless aligned to the wrong corridor, floor, or building transform. Automatically resuming spatial guidance would turn a transient estimate into an unsafe navigation decision.

## Decision

Localization runtime state is separate from estimator quality. High quality maps to tracking and active guidance; degraded quality maps to caution. Lost quality records the loss time and freezes guidance.

A plausible estimate after loss moves the runtime only to `relocalizing`; guidance remains frozen. Returning to tracking requires explicit confirmation from a recent trusted visual or manual anchor. The recovery transition records anchor identity and elapsed recovery time.

## Consequences

- UI and AR clients have a deterministic signal for hiding or freezing spatial instructions.
- A nearby route or plausible filter update cannot silently clear a lost state.
- Replay can measure recovery duration and explain the anchor that restored tracking.
- Live anchor acquisition and building-to-device transform recovery are not implemented yet.
