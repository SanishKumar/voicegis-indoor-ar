# Asterion assumption audit

Venue Bootstrap v0 audited source, build scripts, tests, documentation, package
storage, and presentation code.

| Previous assumption                                                 | Location                       | Venue Bootstrap v0 disposition                               |
| ------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Asterion package imported by application code                       | `src/data/compiledBuilding.ts` | Removed; adapter is constructed from the active artifact     |
| Module-level graph, POI, floor, and connector maps                  | data adapter and route policy  | Replaced with package-scoped runtime maps                    |
| Routing policy and worker use Asterion globals                      | routing engine                 | Active runtime/package is an explicit input                  |
| Search reads the bundled POI singleton                              | search engine                  | Active visitor POIs are an explicit input                    |
| 2D and 3D viewers import Asterion geometry                          | viewer components              | Both consume active package context                          |
| Building name, floor count, default floor, and entry are hard-coded | building config and welcome UI | Derived from package metadata                                |
| Medical-only welcome copy and quick categories                      | welcome UI                     | Venue-neutral copy and package-derived categories            |
| Unknown POI categories have no rendering style                      | visitor adapter                | Deterministic fallback styles are generated                  |
| Asterion outage overlay imported into live navigation               | navigation context             | Removed; Inspector loads package-bound overlays              |
| Outage failure copy compares one Asterion overlay ID                | navigation panel               | Generalized to receipt closure evidence                      |
| Engineering outage and graph controls appear in Visitor             | floor plan/header              | Moved behind Inspector boundary                              |
| Package cache bootstraps only one bundled import                    | cache runtime                  | Activates the verified candidate supplied by loader          |
| Runtime activation exists per building but not live switching       | package/context layer          | Active runtime switches only after verification              |
| Tests depend on application singleton exports                       | regression tests               | Explicit fixture runtimes; application has no fixture import |
| Build exposes only Asterion compiler scripts                        | `package.json`                 | Harbor compile and artifact-sync checks added                |

## Intentional remaining fixture references

Asterion remains a named compiler/routing regression fixture, and its outage
overlay remains test input. Screenshots and benchmark documentation also name it.
These references do not select runtime data or prevent another venue from
loading.

## Remaining coupling

- Runtime supports the current `0.2.0` package and compiler versions only.
- `CompiledBuildingPackage` and some database names retain historical “building”
  terminology.
- The compiler's corridor graph optimization still assumes one dominant axis
  before falling back to centroid connections.
- Render geometry remains semantic 2D extrusion rather than dedicated package
  mesh/occlusion assets.
- The package catalog is a static JSON artifact.
- The routing worker receives a package per request rather than holding an
  acknowledged active-package generation.
- Package signing, provenance, remote registry policy, and multi-tab coordination
  are not implemented.
- Localization replay remains an independent package-identified pipeline; live
  localization activation is not part of this web milestone.
