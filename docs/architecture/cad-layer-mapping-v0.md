# CAD Layer Mapping Workspace v0

## Scope

This slice allows an ordinary ASCII DXF to enter the existing deterministic
importer without renaming layers in a CAD application:

```text
ordinary ASCII DXF
  -> layer inventory
  -> explicit human-reviewed floor/space/portal mapping profile
  -> annotated DXF adapter
  -> BuildingSource validation
  -> staged Studio draft
```

The mapping workspace does not infer semantics from layer names or geometry. A
person chooses which supported layer represents a floor, space, or portal and
supplies the required canonical metadata.

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
    }
  ]
}
```

Mappings are sorted by source-layer name and then entity key. A closed polygon
entity key is derived from canonical geometry. A line key also sorts its
endpoints. Starting vertex, winding, line direction, mapping-form order, and DXF
entity order therefore do not change the resulting `BuildingSource` or
VenuePackage hash.

## Guardrails

- `$INSUNITS` remains mandatory and values are shown in the drawing's declared
  units.
- A whole-layer floor or space mapping must contain exactly one closed
  `LWPOLYLINE`.
- When a layer contains multiple entities, each valid closed `LWPOLYLINE` and
  non-zero `LINE` is listed separately and may be mapped using its canonical
  `sourceEntityKey`.
- Identical selectable entities on one layer deliberately share an identity and are
  rejected as ambiguous rather than selected by unstable file position.
- A whole-layer portal mapping must contain exactly one `LINE`. Shared-layer
  portals select one canonical line identity. Its midpoint becomes the portal
  position and its length becomes the portal width.
- Slice 4 accepts individual floor/space polygons and individual portal lines.
  Entity type and selected semantic role must agree.
- Public and accessibility policy for spaces must be explicitly selected.
- Kind, connected spaces, accessibility, and restriction policy for portals
  must be explicitly selected. A portal cannot connect a space to itself.
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

## Remaining CAD mapping work

- mixed semantic entity types on one source layer;
- selecting individual point-based POIs, anchors, and connector stops;
- connector, POI, and localization-anchor mapping;
- saving, loading, and versioning mapping profiles as artifacts;
- multi-file floor alignment and georeferencing;
- blocks, inserts, hatches, splines, holes, DWG, PDF, IFC/BIM, and GeoJSON;
- automatic recognition and every CV/scanning workflow.
