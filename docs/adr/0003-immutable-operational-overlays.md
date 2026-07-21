# ADR 0003: Keep operational closures outside immutable building packages

- Status: accepted
- Date: 2026-07-22

## Context

Corridors, doors, lifts, and stairs can become unavailable without changing the underlying surveyed building. Recompiling a building package for each temporary closure would destroy useful cache identity and make it difficult to explain which operational state produced a route. Silently ignoring an invalid closure is unsafe.

## Decision

Building packages remain immutable and content-addressed. Temporary operational state is supplied as a separately versioned overlay that declares:

- the exact building ID and package hash it targets;
- an explicit activation and expiry window;
- closures targeting a compiled edge ID or source-object ID;
- a stable closure ID and human-readable reason.

Overlay evaluation always receives an explicit timestamp. Wrong package hashes, malformed data, unknown targets, future overlays, and expired overlays reject the route before pathfinding. Valid source-object closures resolve to every compiled edge derived from that source.

Every policy calculation returns a receipt containing the package hash, profile, overlay identity, applied closure IDs, excluded-edge counts, selected vertical connectors, and route status.

## Consequences

- Replays are deterministic because neither wall-clock time nor mutable global state is read by the policy core.
- Cached packages retain stable identity while operational overlays can change independently.
- A stale overlay fails visibly instead of producing a route under partially applied policy.
- Venue distribution, signature, and authorization mechanisms are still required before overlays can represent live operations.
