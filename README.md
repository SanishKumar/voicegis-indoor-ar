# VoiceGIS Indoor Spatial Twin

[![Quality](https://github.com/SanishKumar/voicegis-indoor-ar/actions/workflows/quality.yml/badge.svg)](https://github.com/SanishKumar/voicegis-indoor-ar/actions/workflows/quality.yml)

An offline-first indoor spatial-intelligence project for compiling building data, calculating constraint-aware routes, and eventually delivering uncertainty-aware localization, voice control, and world-anchored guidance.

This repository is being rebuilt in public from an earlier hospital-navigation prototype. The original state is preserved at [`prototype-v0`](https://github.com/SanishKumar/voicegis-indoor-ar/tree/prototype-v0).

## Current status

The web application is a working, single-floor prototype—not yet a production indoor-localization system.

Implemented today:

- A searchable hospital floor model with fuzzy POI lookup
- A typed, deterministic A* routing core
- A persistent Web Worker for route calculation
- Bearing-derived turn instructions
- Accessibility-aware edge filtering
- Structural graph validation and route invariants
- A pan-and-zoom 2D/2.5D floor-plan view
- A camera-overlay **preview** for exercising instructions
- Automated lint, type, test, build, and dependency checks

Not implemented yet:

- Real user localization or movement tracking
- Multi-floor routing and vertical connectors
- A spatial map compiler or imported building data
- A real 3D digital twin
- World-anchored AR, pose alignment, or occlusion
- VoiceGIS command execution
- Session recording, replay, or physical-walk benchmarks

The camera view is deliberately labeled **Camera Preview** because its graphics are screen-aligned. It does not know the device pose or the user's position and should not be described as AR.

## Why this exists

Indoor navigation becomes difficult where GPS stops being useful and mistakes are stressful: hospitals, transit hubs, campuses, and public facilities. The long-term system is intended to make four hard problems work together:

1. Compile source floor plans into validated, versioned building packages.
2. Fuse visual, inertial, and explicit anchor observations while exposing uncertainty.
3. Calculate explainable routes under accessibility and operational constraints.
4. Present the same route through a 3D map, mobile AR, and deterministic voice operations.

An LLM may interpret a request, but it must not decide whether a corridor is accessible or an emergency route is safe. Those decisions belong to typed data, routing policy, and auditable execution receipts.

## Current architecture

```mermaid
flowchart LR
  UI["React visitor UI"] --> State["Navigation state"]
  State --> Facade["Routing facade"]
  Facade --> Worker["Persistent Web Worker"]
  Worker --> Core["Pure TypeScript A* core"]
  Core --> Graph["Prototype building graph"]
  Graph --> Validation["Graph validation tests"]
```

The route algorithm is isolated from the worker transport, so it can be run deterministically in unit tests and later reused by replay and server-side tooling.

## Run locally

Requirements:

- Node.js 22 or newer
- npm

```bash
npm ci
npm run dev
```

Run the same quality gate used by CI:

```bash
npm run check
```

Individual commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Repository map

```text
src/
├── components/               visitor UI and camera preview
├── context/                  navigation state and user preferences
├── data/                     preserved prototype geometry and graph
└── engine/
    ├── routingCore.ts        pure A* and turn generation
    ├── routingEngine.ts      persistent-worker request facade
    ├── routing.worker.ts     worker transport boundary
    ├── graphValidation.ts    structural graph checks
    └── searchIndex.js        fuzzy POI lookup

docs/
├── adr/                      architecture decision records
├── architecture/             target system boundaries
├── build-in-public.md        public progress-post drafts
└── roadmap.md                evidence-based delivery phases
```

## Roadmap

The next major milestone is a versioned multi-floor spatial schema and compiler—not a prettier fictional map. It will introduce spaces, portals, vertical connectors, accessibility properties, coordinate transforms, and machine-readable validation reports before the 3D viewer is rebuilt.

See [the delivery roadmap](docs/roadmap.md) and [the target architecture](docs/architecture/overview.md).

## Review wanted

Useful review is especially welcome from people working with:

- Indoor GIS, IndoorGML, BIM, IFC, CAD, or floor-plan conversion
- Accessibility and hospital wayfinding
- SLAM, visual localization, sensor fusion, or map matching
- Graph routing and dynamic path planning
- ARCore, ARKit, AR Foundation, or WebXR

If you review the project, please challenge the data model and failure handling before the visuals. The most useful question is not “Does the arrow look good?” but “What evidence would make this safe to trust during a real walk?”

## License

No open-source license has been selected yet. Until one is added, the repository remains all-rights-reserved by default.
