# CAD Layer Mapping Workspace v0

## Scope

This slice allows an ordinary ASCII DXF to enter the existing deterministic
importer without renaming layers in a CAD application:

```text
ordinary ASCII DXF
  -> layer inventory
  -> explicit human-reviewed floor/space/portal/POI/connector-stop/anchor mapping profile
  -> annotated DXF adapter
  -> BuildingSource validation
  -> staged Studio draft
```

The mapping workspace does not infer semantics from layer names or geometry. A
person chooses which supported entity represents a floor, space, portal, POI,
vertical-connector stop, or localization anchor and supplies the required
canonical metadata.

## Profile contract

```json
{
  "profileVersion": "0.1.0",
  "mappings": [
    {
      "sourceLayer": "A-FLOOR-OUTLINE",
      "targetLayer": "VG$FLOOR$g$0$0$3.2$Ground%20Floor"
    },
    {
      "sourceLayer": "A-SPACE-ENTRY",
      "targetLayer": "VG$SPACE$g$entry$entrance$true$true$Entry%20Lobby"
    },
    {
      "sourceLayer": "A-ROOMS",
      "sourceEntityKey": "lwpolyline:4,0;12,0;12,8;4,8",
      "targetLayer": "VG$SPACE$g$gallery$room$true$true$Gallery"
    },
    {
      "sourceLayer": "A-DOOR-ENTRY-GALLERY",
      "targetLayer": "VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false"
    },
    {
      "sourceLayer": "A-DOORS",
      "sourceEntityKey": "line:8,3.5;8,4.5",
      "targetLayer": "VG$PORTAL$g$gallery-archive-door$door$gallery$archive$true$false"
    },
    {
      "sourceLayer": "A-POIS",
      "sourceEntityKey": "point:6,4",
      "targetLayer": "VG$POI$g$gallery$featured-exhibit$exhibit$true$true$Featured%20Exhibit"
    },
    {
      "sourceLayer": "A-RAMP-STOPS",
      "sourceEntityKey": "point:4,4",
      "targetLayer": "VG$CONNECTOR$east-ramp$ramp$true$false$g$entry$East%20Ramp"
    },
    {
      "sourceLayer": "A-RAMP-STOPS",
      "sourceEntityKey": "point:4.2,4",
      "targetLayer": "VG$CONNECTOR$east-ramp$ramp$true$false$l1$gallery$East%20Ramp"
    },
    {
      "sourceLayer": "A-ANCHORS",
      "sourceEntityKey": "point:2,2",
      "targetLayer": "VG$ANCHOR$g$entry$entry-anchor$qr$90$vg%3Aentry-anchor"
    }
  ]
}
```

Mappings are sorted by source-layer name and then entity key. Closed polygon
keys use canonical geometry, line keys sort their endpoints, and point keys use
rounded XY coordinates. Starting vertex, winding, line direction, mapping-form
order, and DXF entity order therefore do not change the resulting
`BuildingSource` or VenuePackage hash.

## Reusable profile artifacts

A completed profile can be saved as a JSON artifact and replayed against a later
revision of the same drawing:

```json
{
  "artifactVersion": "0.1.0",
  "profileVersion": "0.1.0",
  "sourceFileName": "unannotated-shared-anchors-v0.dxf",
  "mappings": [{ "sourceLayer": "A-FLOOR-OUTLINE", "targetLayer": "VG$FLOOR$g$0$0$3.2$Ground%20Floor" }]
}
```

Artifacts are canonical JSON, so the same profile always produces the same bytes
and the same SHA-256 artifact hash. `sourceFileName` is provenance only and never
gates loading — replaying a profile onto a different drawing is the point.

Loading resolves every mapping against the slots the open drawing actually
offers. A selection that no longer exists, a whole-layer mapping on a layer that
has since gained entities, a duplicated selection, or a hand-edited target layer
carrying an unknown role, enum, or unreviewed policy fails the entire restore and
leaves the current mapping untouched. Only a fully valid mapping can be saved, so
an artifact never captures a half-reviewed draft.

## Guardrails

- `$INSUNITS` remains mandatory and values are shown in the drawing's declared
  units.
- A whole-layer floor or space mapping must contain exactly one closed
  `LWPOLYLINE`.
- When a layer contains multiple entities, each valid closed `LWPOLYLINE`,
  non-zero `LINE`, and planar `POINT` is listed separately and may be mapped
  using its canonical `sourceEntityKey`.
- Identical selectable entities on one layer deliberately share an identity and are
  rejected as ambiguous rather than selected by unstable file position.
- A whole-layer portal mapping must contain exactly one `LINE`. Shared-layer
  portals select one canonical line identity. Its midpoint becomes the portal
  position and its length becomes the portal width.
- A whole-layer POI, connector-stop, or localization-anchor mapping must contain
  exactly one `POINT`. Shared-layer semantic points select one canonical point
  identity.
- Slice 7 accepts individual floor/space polygons, portal lines, POI points,
  connector-stop points, and localization-anchor points. Entity type and selected
  semantic role must agree.
- Public and accessibility policy for spaces must be explicitly selected.
- Kind, connected spaces, accessibility, and restriction policy for portals
  must be explicitly selected. A portal cannot connect a space to itself.
- Floor, containing space, category, public policy, and accessibility policy for
  POIs must be explicitly selected.
- Every connector stop requires a connector ID, name, kind, floor, containing
  space, accessibility policy, and restriction policy. A connector requires at
  least two stops, may have only one stop per floor, and every stop sharing its
  ID must use identical connector metadata.
- Every mapped object needs its own canonical id. Connector stops are the single
  exception, because sharing an id is how stops are grouped into one connector;
  that shared id still may not collide with any other role.
- Every floor and space reference must resolve against an id this mapping
  actually creates. Renaming a mapped space after wiring a portal to it is the
  usual way to strand a reference. The compiler remains authoritative, but the
  workspace reports these on the field that can be fixed rather than deferring
  to a compiler path like `/portals/2/connects/0`.
- Every localization anchor requires an ID, floor, containing space, kind, a
  surveyed heading in `[0, 360)`, and a payload of at most 512 characters. Two
  anchors may not share one payload, because a scanned payload must identify
  exactly one anchor before frozen guidance is allowed to recover.
- Invalid profiles, unsupported geometry, schema failures, and semantic failures
  preserve the exact current Studio draft.
- A mapped import is staged only. Compilation, publishing, and runtime activation
  remain separate explicit operations.

## Reference fixture

`buildings/import-fixtures/unannotated-lobby-v0.dxf` contains three ordinary CAD
layers: one floor outline, one entry-space polygon, and one annotation layer.
Studio inventories all three, allows the two closed polylines to be mapped, and
keeps the text layer inspection-only.

`buildings/import-fixtures/unannotated-two-room-v0.dxf` adds a second space and
an ordinary `LINE` on a door layer. Mapping that line as a portal produces a
semantically validated, routable connection between the entry and gallery.

`buildings/import-fixtures/unannotated-shared-rooms-v0.dxf` places both rooms on
the same ordinary `A-ROOMS` layer. Studio presents two geometry previews and
maps each polygon independently while preserving deterministic package identity
when entity order changes.

`buildings/import-fixtures/unannotated-shared-doors-v0.dxf` places two door
lines on one ordinary `A-DOORS` layer. Studio maps each line to a different
space pair and the compiled graph contains two independently routable portals.

`buildings/import-fixtures/unannotated-shared-pois-v0.dxf` adds two points on
one ordinary `A-POIS` layer. Studio maps each point to an independently named,
categorized, and policy-reviewed POI while preserving deterministic package
identity when entity order changes.

`buildings/import-fixtures/unannotated-shared-connector-stops-v0.dxf` contains
two floors and two points on one ordinary `A-RAMP-STOPS` layer. Studio groups
the points into one accessible ramp with explicitly assigned floor and space
stops; compiler validation proves the upper public space remains reachable.

`buildings/import-fixtures/unannotated-shared-anchors-v0.dxf` places two points on
one ordinary `A-ANCHORS` layer, plus one entry POI so the compiled draft also
satisfies the runtime bootstrap contract. Studio maps each anchor point to an
independently surveyed anchor with its own kind, heading, and payload, and
refuses two anchors that would answer to the same scanned payload.

## Remaining CAD mapping work

- a stored profile registry with revision history and promotion, beyond the
  single save/load artifact in this slice;
- multi-file floor alignment and georeferencing;
- blocks, inserts, hatches, splines, holes, DWG, PDF, IFC/BIM, and GeoJSON;
- automatic recognition and every CV/scanning workflow.
