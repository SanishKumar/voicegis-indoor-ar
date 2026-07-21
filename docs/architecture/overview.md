# Architecture direction

## Objective

Turn heterogeneous building data into a versioned, offline-capable package that multiple clients can inspect and navigate without redefining topology, accessibility, or coordinate transforms.

The project is split conceptually into four systems:

```text
source geometry
    │
    ▼
spatial compiler ──► versioned building package
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
         localization runtime        routing policy
                 └────────────┬────────────┘
                              ▼
                    navigation runtime
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
              3D map       mobile AR    VoiceGIS
```

## System boundaries

### Spatial compiler

Responsibilities:

- Normalize imported or authored geometry into a shared coordinate system.
- Extract or author spaces, walls, doors, portals, and vertical connectors.
- Generate navigation topology from walkable space.
- Produce render, occlusion, routing, and localization artifacts.
- Reject packages that violate hard invariants.

The compiler owns derived data. Clients should not repair malformed topology at runtime.

### Versioned building package

A package will be immutable and content-addressed. At minimum it should contain:

- Building and floor metadata
- Coordinate reference and transform metadata
- Semantic spaces, portals, POIs, and landmarks
- Multi-floor routing graph
- Accessibility and restriction attributes
- Render and occlusion geometry
- Localization-anchor manifest
- Validation report and schema version

Package signing, delta distribution, and rollback belong to later venue-platform work, but version identity must exist in the first schema.

### Localization runtime

Localization should publish an estimate rather than a perfect-looking dot:

```text
position (x, y, z)
heading and velocity
active floor
position and heading covariance
observation sources
last correction timestamp
quality state: high / degraded / lost
```

Route guidance consumes this estimate. When quality is lost, the navigation runtime must freeze misleading spatial content and request relocalization.

### Routing policy

Routing is deterministic. Costs and prohibitions come from typed attributes, operational state, and an explicit user profile. Every route should return an explanation receipt containing selected connectors, avoided constraints, distance, duration estimate, and package version.

### Navigation runtime

The runtime owns progress gates, instruction advancement, wrong-way hysteresis, rerouting, arrival, and recovery. UI clients render this state but do not independently decide that a waypoint has been crossed.

### Presentation clients

- The web viewer inspects packages, topology, routes, and operations state.
- The mobile client performs production localization and world-anchored AR.
- The voice adapter converts grounded user intent into typed navigation operations.
- A later VR client reuses building packages for route rehearsal and training.

## Design rules

1. Geometry, semantics, topology, and rendering artifacts are related but distinct.
2. Coordinate transforms are explicit, versioned data.
3. Uncertainty is a first-class state, not an implementation detail.
4. Accessibility constraints fail closed.
5. LLM output cannot directly mutate safety-relevant navigation state.
6. Physical-walk traces must be replayable without camera footage by default.
7. Every marketing claim should map to a reproducible test or labeled prototype behavior.

## Immediate next slice

The first compiler slice will use a small, reviewable JSON source format before adding complex IFC or CAD importers. It should prove:

- Two floors with aligned vertical connectors
- Rooms connected through explicit door portals
- Coordinate transforms and units
- Public and restricted POIs
- Wheelchair-accessible versus stair-only routes
- Deterministic compilation output
- Validation failures for disconnected spaces and invalid connectors

Once this package exists, the React Three Fiber viewer can consume compiled data rather than creating a second hardcoded representation.
