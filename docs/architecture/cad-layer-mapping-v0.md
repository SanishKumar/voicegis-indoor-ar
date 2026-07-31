# CAD Layer Mapping Workspace v0

## Scope

This slice allows an ordinary ASCII DXF to enter the existing deterministic
importer without renaming layers in a CAD application:

```text
ordinary ASCII DXF
  -> layer inventory
  -> explicit human-reviewed floor/space mapping profile
  -> annotated DXF adapter
  -> BuildingSource validation
  -> staged Studio draft
```

The mapping workspace does not infer semantics from layer names or geometry. A
person chooses which supported layer represents a floor or a space and supplies
the required canonical metadata.

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
    }
  ]
}
```

Mappings are sorted by source-layer name. Reordering the mapping form or DXF
entities does not change the resulting `BuildingSource` or VenuePackage hash.

## Guardrails

- `$INSUNITS` remains mandatory and values are shown in the drawing's declared
  units.
- A mapped layer must contain exactly one closed `LWPOLYLINE`.
- Slice 1 accepts only floor and space roles.
- Public and accessibility policy for spaces must be explicitly selected.
- Invalid profiles, unsupported geometry, schema failures, and semantic failures
  preserve the exact current Studio draft.
- A mapped import is staged only. Compilation, publishing, and runtime activation
  remain separate explicit operations.

## Reference fixture

`buildings/import-fixtures/unannotated-lobby-v0.dxf` contains three ordinary CAD
layers: one floor outline, one entry-space polygon, and one annotation layer.
Studio inventories all three, allows the two closed polylines to be mapped, and
keeps the text layer inspection-only.

## Remaining CAD mapping work

- multiple semantic objects on one source layer;
- selecting individual entities instead of whole layers;
- portal, connector, POI, and localization-anchor mapping;
- saving, loading, and versioning mapping profiles as artifacts;
- multi-file floor alignment and georeferencing;
- blocks, inserts, hatches, splines, holes, DWG, PDF, IFC/BIM, and GeoJSON;
- automatic recognition and every CV/scanning workflow.
