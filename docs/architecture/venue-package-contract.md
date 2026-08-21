# VenuePackage runtime contract

## Scope

Venue Bootstrap v0 establishes the portable boundary between deterministic
compilation and every runtime consumer:

```text
Importer -> BuildingSource -> Compiler -> VenuePackage -> Runtime
```

An importer may eventually read BIM, CAD, a floor plan, a scan, IndoorGML, or an
authoring tool. It must emit the canonical `BuildingSource`; it does not write a
routing graph or application state. The compiler remains the only component that
normalizes source order, validates hard invariants, derives routing topology, and
computes package identity.

The first implemented adapter is the constrained, non-CV
[DXF Importer v0](dxf-importer-v0.md). It accepts an explicitly annotated ASCII
DXF profile and fails closed rather than interpreting ambiguous CAD geometry.

RoomPlan, ARCore, SLAM, automatic recognition, visual positioning, and
world-anchored AR are outside this milestone.

## Artifact format

The current artifact is one UTF-8 JSON document:

```text
VenuePackage
├── packageVersion              "0.2.0"
├── sourceSchemaVersion         "0.1.0"
├── compilerVersion             "0.2.0"
├── building
│   ├── id / name / units
│   ├── entrySpaceId
│   └── coordinateSystem
├── floors[]
├── spaces[]
├── portals[]
├── verticalConnectors[]
├── pois[]
├── localizationAnchors[]
├── routing
│   ├── nodes[]
│   └── edges[]
└── manifest
    ├── hashAlgorithm           "sha256"
    └── contentHash
```

The compiler canonicalizes object keys and source collection order. The content
hash is SHA-256 over canonical package JSON without `manifest`. Recompiling the
same normalized source must produce byte-equivalent package and validation
artifacts.

## Runtime verification

The browser accepts a package from:

- a catalog URL;
- an arbitrary CORS-readable URL;
- a local JSON artifact selected in Inspector.

Activation is rejected unless all of the following pass:

1. supported package, source-schema, and compiler versions;
2. required building and collection shape;
3. finite floor, space, and graph geometry;
4. unique semantic, graph-node, and graph-edge identifiers;
5. valid floor, space, source, and graph endpoint references;
6. explicit `accessible` and `restricted` routing policy values;
7. a public entry POI for deterministic visitor bootstrap;
8. canonical SHA-256 content verification.

Accessibility fails closed. Missing accessibility flags are invalid package data;
the runtime never upgrades unknown values to accessible.

The candidate is installed and activated in the existing content-addressed
IndexedDB registry when storage is available. The in-memory active runtime
changes only after verification completes. A rejected candidate leaves the
current package active. Cache unavailability is reported separately and does not
reinterpret a verified package.

Package signatures, trust roots, delta updates, quota policy, and cross-tab
activation coordination remain future work.

## Active-package isolation

`buildingId:contentHash` is the runtime identity. React navigation state is keyed
by that identity, so a venue change recreates:

- active floor and default start;
- selected destination and POI;
- current route, steps, and receipt;
- operational overlay and its evaluation time;
- future venue-scoped localization estimate state.

Search, routing, floor controls, the 2D plan, the 3D twin, POIs, connector names,
and localization anchors all read from the same active runtime adapter.
Operational overlays remain separate immutable artifacts, but are validated
against the active building ID and package hash and are cleared on venue change.

The routing worker receives the active package with each request. Route receipts
continue to include the active `buildingId`, package hash, profile, closures,
excluded-edge counts, and selected connectors.

## Application boundaries

- `#/visitor` contains public search, routing, plan, camera guidance preview, and
  accessibility preferences.
- `#/inspector` contains the compiled 3D twin, graph/anchor inspection, package
  URL/file activation, catalog switching, and closure-overlay loading.
- `#/studio` contains the BuildingSource authoring workspace: source editing, DXF
  import with layer mapping, floor canvas editing, compile-in-browser, and a
  publish dry run. It was a boundary placeholder in Venue Bootstrap v0 and no
  longer is. What it still cannot do is publish for real: the catalog remains a
  static artifact, so promoting or archiving a release is out of scope.
- `#/recorder` records a walk from the handset's own sensors. It is an instrument
  for measuring sensor behaviour, not live localization, and what it captures is
  refused as evidence by policy.

This keeps package diagnostics and engineering-only controls out of the visitor
surface without redesigning the entire application.

## Bundled proof venues

| Property   | Asterion                            | Harbor Exchange                           |
| ---------- | ----------------------------------- | ----------------------------------------- |
| Domain     | academic medical center             | ferry, market, and community exchange     |
| Floors     | 4 repeated clinical levels          | 2 unequal footprints                      |
| Connectors | lifts and stairs across four levels | lift, stair, and escalator                |
| POIs       | clinical, diagnostics, services     | transit, market, gallery, cafe, community |
| Anchors    | 9                                   | 3                                         |

Both are compiler artifacts served from `public/venues/` and selected through
`public/venues/catalog.json`. Neither is imported by application source code.

## Venue Studio v0 — delivered

This was written as the next step and has since been built. It is recorded as
done rather than deleted, because the scope it defined is what `#/studio`
actually does:

1. open an existing `BuildingSource` JSON file — **done**;
2. render its floors, spaces, portals, connectors, POIs, and validation issues —
   **done**;
3. allow deterministic edits to metadata and geometry with explicit
   accessibility values — **done**;
4. run the existing compiler unchanged in a worker or service — **done**,
   compiled in the browser;
5. show the validation report and package hash — **done**;
6. publish/download the verified `VenuePackage` and add its URL to a catalog —
   **partly**. Download and a publish dry run exist; the catalog is still a
   static artifact, so adding a release is not possible from Studio.

Scan reconstruction was correctly left out and remains out.

## Exact next step: a browser smoke suite

The unit gate does not exercise the visitor journey. Three defects have reached
review through a green build — a blank map after visiting the 3D surface, a
scanner that stopped its own successor's camera, and navigation controls that
overlap on a phone — and none of them were the kind a unit test was ever going
to see. Onboarding, routing, surface switching, check-in rejection and mobile
navigation should each have one browser-level test before this is shown to
anyone unguided.
