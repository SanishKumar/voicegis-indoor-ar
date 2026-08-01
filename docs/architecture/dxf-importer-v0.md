# DXF Importer v0 contract

## Scope

DXF Importer v0 is the first non-CV ingestion adapter:

```text
annotated ASCII DXF
  -> deterministic DXF adapter and import report
  -> canonical BuildingSource 0.1.0
  -> existing compiler
  -> verified VenuePackage
  -> optional, explicitly confirmed runtime activation
```

It proves the importer boundary without attempting automatic floor-plan
recognition. It does not infer room meaning, connectivity, accessibility, units,
or localization metadata from drawing appearance.

## Accepted file profile

- ASCII DXF only; binary DXF and DWG are rejected.
- Model-space 2D entities at `Z=0` only.
- `$INSUNITS` is mandatory. Supported values are inches, feet, millimeters,
  centimeters, and meters. Geometry, floor elevation, and clear height are
  converted to meters.
- Semantic entities must use the explicit `VG$...` layers below.
- Names and payloads use URI percent encoding inside layer names.
- Accessibility, public, and restricted flags must be the literal `true` or
  `false`. Unknown policy never defaults to accessible.

| Meaning             | DXF entity          | Layer grammar                                                     |
| ------------------- | ------------------- | ----------------------------------------------------------------- |
| Floor               | closed `LWPOLYLINE` | `VG$FLOOR$id$level$elevation$clearHeight$name`                    |
| Space               | closed `LWPOLYLINE` | `VG$SPACE$floorId$id$type$public$accessible$name`                 |
| Portal              | `LINE`              | `VG$PORTAL$floorId$id$kind$spaceA$spaceB$accessible$restricted`   |
| Connector stop      | `POINT`             | `VG$CONNECTOR$id$kind$accessible$restricted$floorId$spaceId$name` |
| POI                 | `POINT`             | `VG$POI$floorId$spaceId$id$category$public$accessible$name`       |
| Localization anchor | `POINT`             | `VG$ANCHOR$floorId$spaceId$id$kind$headingDegrees$payload`        |

The portal position is the line midpoint and its width is the line length.
Connector points with the same connector identifier are grouped into ordered
stops. Exactly one public `entrance` space is required and becomes
`building.entrySpaceId`.

Closed lightweight polylines may contain DXF bulges. Curves are tessellated at a
fixed maximum ten-degree step, rounded to six decimal places in meters, given a
canonical winding, and rotated to a canonical starting vertex.

## Determinism and failure behavior

Imported collections are sorted by semantic identifier. Portal connections and
connector stops are also normalized. Reordering DXF entities therefore produces
the same `BuildingSource` and VenuePackage hash.

Studio stages the import before touching its editor state. Importer, schema, and
compiler-semantic errors reject the candidate and preserve the exact current
draft. A successful import creates a draft only; it does not compile, publish,
activate, or replace the running venue without the existing explicit controls.

Unannotated drawing entities are ignored and counted in the import report. An
unknown `VG$...` entity is an error, not an invitation to guess.

## Reference fixture

`buildings/import-fixtures/atrium-dxf-v0.dxf` is a small valid two-floor file
containing connected spaces, an accessible elevator, POIs, and a localization
anchor. Open `#/studio`, choose **Import DXF**, and select this fixture to
exercise the browser path.

## Intentionally remaining

- mixed semantic entity types on one CAD layer;
- legacy `POLYLINE`, blocks, inserts, hatches, splines, and polygon holes;
- distinct wall-body geometry in `BuildingSource`;
- multi-file floor alignment and georeferencing;
- DWG, vector PDF, IFC/BIM, IndoorGML, and GeoJSON adapters;
- automatic recognition, scans, video, CV, SLAM, and world-anchored AR.

Those capabilities should extend this ingestion boundary rather than bypass the
canonical source or deterministic compiler.

The implemented human-reviewed
[CAD Layer Mapping Workspace v0](cad-layer-mapping-v0.md) maps ordinary DXF
floor and space polygons—including multiple polygons on one layer—and portal
lines—including multiple doors on one layer—and POI points—including multiple
points on one layer—and grouped vertical-connector stops into this annotated
profile without guessing.
