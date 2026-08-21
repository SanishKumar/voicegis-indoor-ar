# Venue version catalog v0

The version catalog is a read-only discovery index for immutable VenuePackages.
It is not a publishing service and is not trusted as proof that a package is
valid. Runtime activation still downloads the selected package and performs the
full VenuePackage contract and SHA-256 verification.

## Boundary

```text
Publisher (future)
  -> catalog.json release metadata
  -> catalog contract validation
  -> package URL selection
  -> VenuePackage download and verification
  -> controlled runtime activation
```

Catalog version `0.2.0` contains:

- a default venue;
- stable venue identity and descriptive metadata;
- one or more releases per venue;
- a default release per venue;
- release status and publication timestamp;
- package, compiler, and source-schema versions;
- the complete package content hash and package URL;
- release notes and entity-count summaries.

Release identity is scoped to a venue. Content hashes and package URLs are
unique across the catalog. Default venue and release references must resolve,
and all count metadata must be non-negative integers.

The browser validates the complete catalog before using any entry. It then
normalizes each venue's default release into the existing runtime picker shape,
so Inspector and bootstrap loading continue to use the same package URL
activation boundary.

## Current limitations

- The catalog is a static deployment artifact.
- It contains one release for each bundled venue.
- Studio cannot add, promote, archive, or publish releases *to the catalog*,
  which is what makes the catalog static. Studio itself is not read-only: it
  edits sources, imports DXF, compiles in the browser, downloads a verified
  package, and runs a publish dry run. What it cannot do is change this file.
- Catalog metadata is not a signature or trust root.
- Package signing, authorization, remote storage, concurrent publishing, and
  durable release history remain future work.
