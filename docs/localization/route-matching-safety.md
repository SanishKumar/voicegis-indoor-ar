# Route matching and floor safety

Phase 2 slice E, 14 September 2026. Deterministic software safeguards only;
Visitor progress is still manual and no live positioning is enabled.

## What now refuses guidance

The matcher retains raw estimates and gives each refusal a reason. It does not
change filter coordinates, choose a new route, or upgrade localization quality.

| Reason                        | Boundary                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `forward-progress`            | Candidate exceeds the forward increment, or advances at the same timestamp                                  |
| `backward-progress`           | Candidate falls behind the retained high-water mark beyond jitter tolerance                                 |
| `ambiguous-route`             | Geometrically distinct route legs are indistinguishable inside the distance/uncertainty band                |
| `route-discontinuity`         | Changing segments lacks a same-floor chain with continuous endpoints and cumulative distance                |
| `floor-transition-unverified` | Floor change is pending, or the route tracker would switch from its acquired floor                          |
| `invalid-input`               | Invalid coordinates, uncertainty, tuning, chronology, duplicate segment IDs or inconsistent segment lengths |

Existing `no-route`, `quality-lost`, `wrong-floor` and `outside-gate` refusals
remain. An ambiguous result has **no preferred projection or progress**. Other
rejections may retain a candidate for diagnostics; `accepted: false` means it
must not drive guidance. Invalid-input results also invalidate evidence replay
statistics, so clean-looking refusal outputs cannot hide malformed route data.

### Bounded, not field calibrated

Defaults retain the 1.25 m base gate, 2.5× position-sigma multiplier, 6 m maximum
gate and 1 m backward tolerance. New tuning caps forward progress at **2 m per
accepted update**. The ambiguity band is the larger of **0.5 m** and 2.5×
position sigma, considering only projections inside the spatial gate.

These are conservative software settings, **not measured human speed, corridor
clearance or positioning accuracy**. The forward increment is not a speed model
or an observed-motion budget. Waiting does not enlarge it; the cap also means a
legitimate larger checkpoint correction can require explicit reacquisition.
Same-timestamp corrections cannot advance the cursor. A future live session must
coordinate sampling, observed movement, correction events and freshness rather
than treating this diagnostic cap as a complete motion model.

Shared turn endpoints and straight contiguous subdivisions represent one route
place, even across multiple tiny segments. Crossing/retraced paths or matching
progress labels alone do not. An ambiguous junction remains a refusal until
observations can distinguish the legs; there is no automatic maneuver advance.

## State belongs to one route

`RouteMatchTracker` snapshots its route and tuning. Its accepted progress is a
high-water mark: tolerated backward jitter cannot repeatedly lower the baseline.
Rejected candidates cannot become the next baseline, and changing returned
results or caller-owned geometry cannot rewrite its state. A separate clock
watermark also prevents rejected frames from permitting later clock regressions.

The tracker does not silently switch floors or reset itself after a refusal.
A new instance denotes a new explicit route/acquisition. That is not itself proof
of location: slice F's [live session](live-session.md) binds reacquisition to an
immutable venue/route snapshot and fresh internally resolved checkpoint, followed
by independent heading and motion. Its observation adapter is not yet implemented.
The stateless matcher is a lower-level diagnostic function; callers supplying
only partial history cannot
expect it to reconstruct missing route/floor context. Replay uses the tracker.

Runtime guidance is now coupled to matching. Once a runtime receives route-match
input, subsequent updates **and explicit relocalization** require an accepted
match for the same timestamp, raw XY position and floor. Omitting the route check
or reusing a previous accepted result cannot reactivate guidance. A rejected
route does not erase an existing lost/relocalizing state. A standalone runtime
never enrolled with a route retains its localization-only API behavior.

## Floor claims and checkpoint reacquisition

An unsupported floor/elevation claim retains the last confirmed floor and sets
`floorTransitionPending`. Strides then grow uncertainty without moving the
position mean; guidance and matching freeze. A later barometer claim of the old
floor cannot clear the pending state, nor can heading calibration replay those
unlocated strides.

Recording 0.2 already represents a decoded rescan as a `position-fix` followed by
a `floor` observation. Floor confirmation now requires that immediately adjacent,
same-time, consecutive-sequence pair from the same manual/visual-anchor source,
with usable position-fix values and floor confidence at least 0.75. The pair is
single-use; stale, mismatched, interrupted or low-confidence pairs cannot confirm.
It can confirm the retained floor or reacquire another floor, but it **does not
prove travel through a particular stair or lift**. The existing route tracker
still refuses to jump to that other floor.

Source labels in hand-authored recordings are declarations, not authentication
or survey provenance. Position/floor are still separate observations, not an
atomic qualified pose event. Typed connector evidence, surveyed alignment and
qualified live observation acquisition remain necessary; no native/barometer
floor-transition capability is claimed here.

## Compatibility and next work

- Processor **0.6.0** binds the changed matching, runtime and floor semantics.
  Policy stays **0.4.0**, and raw Capture Stream/Recording stay **0.2.0**.
- No device-frame sensor model or accuracy evidence is newly admitted. Historical
  processor artifacts need their original build; do not relabel or overwrite them.
- Only the synthetic reference report was regenerated: five new zero-valued
  rejection counters. Its recording, matched counts and runtime counts are unchanged.
- Slice F implements shared session lifecycle/freshness and explicit checkpoint
  reacquisition in [the live-session controller](live-session.md), still without
  a Visitor/handset connection or automatic progress.
- Whole-venue off-route alternatives, mobility-specific movement models, connector
  verification, independent calibration capture and physical pilot validation
  remain open. Matching only the intended route cannot detect every wrong corridor.

The 11 initial regressions failed against the actual pre-change code. Follow-up
tests reproduced shared-progress crossings, same-time advances, stale/omitted
runtime matches, disconnected legs and over-rejection of dense straight segments
in the initial implementation before their corrections. See the visitor plan for
final gate results. Synthetic tests are not a real-building accuracy result.
