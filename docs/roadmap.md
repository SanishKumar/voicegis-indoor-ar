# Evidence-based roadmap

This roadmap uses proof and exit criteria rather than feature percentages.

## Phase 0: trustworthy prototype baseline

Status: baseline exit criteria met; JavaScript-to-TypeScript cleanup continues as technical debt

Delivered:

- Original prototype preserved as `prototype-v0`
- Locked install, linting, TypeScript, tests, build, and GitHub Actions
- Vulnerability-fixed Vite toolchain
- Pure A* routing core and persistent worker
- Route and graph invariants
- Honest camera-preview terminology and resize behavior

Remaining:

- Finish migrating shared data and state modules to TypeScript

Exit evidence:

- `npm run check` passes from a clean checkout
- Every current POI is reachable from the entrance
- Known route distances and turn types are asserted
- Documentation distinguishes current behavior from research goals

## Phase 1: spatial schema and compiler

Status: compiler and synthetic-fixture evidence complete; surveyed pilot data still required

Delivered:

- Versioned TypeScript schema and JSON Schema
- Buildings, floors, spaces, portals, POIs, and vertical connectors
- Units and coordinate transforms
- Deterministic package compiler
- Connectivity, reachability, and accessibility validation report
- A two-floor synthetic engineering fixture

Exit evidence:

- Repeated compilation produces identical package hashes
- Every public POI is reachable under the standard profile
- Accessible POIs remain reachable without stair-only connectors
- Invalid portals, duplicate IDs, and misaligned connectors fail compilation

## Phase 2: 3D inspection and routing policy

Status: in progress

Delivered:

- Package-driven React Three Fiber engineering viewer
- Floor isolation, exploded view, semantic selection, graph and anchor overlays
- Standard and wheelchair profiles across two floors
- Fail-closed restricted edges and explicit vertical instructions
- Package-driven 2D visitor navigation and search
- Immutable, versioned operational closure overlays
- Route receipts with package, profile, closure, connector, and exclusion evidence

Remaining:

- Offline package cache

Exit evidence:

- Routes never cross walls in the pilot fixture
- Closing a corridor or lift changes the route deterministically
- A wheelchair profile never uses a stair-only connector
- A selected 3D object exposes its source ID and routing attributes

## Phase 3: localization and replay

Status: not started

Deliver:

- Surveyed visual anchors
- Pose, inertial, step, heading, and floor observations
- EKF or particle-filter fusion
- Route-constrained map matching
- Explicit covariance and quality states
- Privacy-preserving session recording and deterministic replay

Exit evidence:

- A recorded walk replays to identical estimates
- Ground-truth checkpoints produce median and p95 error reports
- Lost localization freezes misleading guidance
- Known anchors recover the building-to-device transform within a measured time

## Phase 4: world-anchored AR and VoiceGIS

Deliver:

- Floor-anchored route ribbon and decision gates
- Door and landmark labels
- Automatic progress and wrong-way hysteresis
- Relocalization workflow
- Typed VoiceGIS operations, confirmation, cancellation, and receipts
- Spoken prompts with full touch fallback

Exit evidence:

- A user scans an entrance anchor, speaks a destination, walks, deviates, recovers, and arrives without pressing “next”
- Voice interpretation cannot bypass routing constraints
- The complete route and localization session can be replayed

## Phase 5: venue operations and validation

Deliver:

- Building version management and rollback
- POI, closure, and anchor-health operations
- Signed offline distribution
- Privacy-preserving route analytics
- Accessibility testing and public benchmark report
- VR route rehearsal only after AR localization is credible

Exit evidence:

- An operator publishes a closure without changing application source
- Clients can safely roll forward and back between package versions
- Pilot claims are backed by reproducible traces and a device matrix
