# ADR 0008: Activate VenuePackages through one runtime boundary

- Status: accepted
- Date: 2026-07-26

## Context

The compiler already emitted immutable content-addressed packages, but the
browser imported Asterion JSON and derived module-level routing, search, and
render state from that import. IndexedDB verified a bundled package without
making the verified record the source for live runtime consumers. A venue change
therefore required a rebuild and could not prove state isolation.

## Decision

Application code loads compiled package artifacts through URL or file adapters,
checks the supported contract and canonical SHA-256 hash, then creates one
package-scoped runtime adapter. Every consumer receives that adapter through the
active venue context.

Navigation state is keyed by `buildingId:contentHash`. Switching that key
recreates route, floor, POI, closure, and localization-scoped state. The routing
worker receives the package associated with the request. Operational overlays
remain separate and must match the active package.

The product surfaces are separated into Visitor, Inspector, and future Studio
routes. Package activation and diagnostics are Inspector responsibilities.

## Consequences

- New compatible venues can be loaded without source imports or application
  rebuilds.
- A rejected package cannot replace the active runtime.
- Runtime consumers cannot accidentally mix geometry and graph data from
  different package singletons.
- Worker message size is currently larger because the package accompanies each
  route request; a package-activation handshake can optimize this later.
- The catalog is still a static deployment artifact and is not yet a remote
  registry.
