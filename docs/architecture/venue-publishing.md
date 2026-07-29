# Venue publishing v0

Publishing v0 is a dry-run boundary. It turns a verified compiled VenuePackage
and explicit release metadata into a deterministic publish plan, but performs
no remote operations.

```text
verified VenuePackage
  -> canonical package artifact
  -> explicit HTTPS targets and release metadata
  -> publish dry-run validation
  -> downloadable plan and receipt
```

The plan contains:

- the exact package artifact name, byte length, media type, and SHA-256 hash;
- a catalog-compatible release entry;
- an immutable package destination;
- a catalog release-upsert proposal;
- the ordered `PUT` and `PATCH` operations a future publisher would perform;
- a SHA-256 receipt for the canonical dry-run plan;
- explicit safety counters showing zero network requests, catalog writes,
  credentials, and runtime activations.

Generation fails closed when:

- the package or staged artifact fails runtime verification;
- the artifact differs from canonical compiler output;
- the venue does not already exist in catalog v0;
- release notes or publication time are invalid;
- a target is not absolute HTTPS, embeds credentials, or contains a query or
  fragment.

Publishing v0 never promotes the proposed release to default. Promotion,
authorization, package upload, catalog concurrency control, signing, audit
storage, and recovery from partial remote failure remain future work.

## Provider-neutral transport simulator

The next bounded slice defines a transport interface with three operations:

1. read a catalog and its opaque revision;
2. put immutable package bytes at a content-addressed URL;
3. compare-and-swap a validated catalog against the expected revision.

The in-memory adapter exercises this interface without `fetch`, credentials, or
filesystem writes. It verifies the full artifact-byte SHA-256 separately from
the VenuePackage semantic content hash. A package can be stored before catalog
commit, but it is not discoverable as a release until compare-and-swap succeeds.

Concurrent publishers may upload the same immutable bytes idempotently, while
only one can commit a given catalog revision. Stale plans fail during preflight
before package storage. A race at commit leaves at most an unreferenced
content-addressed artifact; it never exposes a partial catalog release.

## Generic HTTP transport contract

The HTTP adapter is deliberately configured through an injected request
function. Studio does not instantiate it with `fetch`, so this slice cannot
perform a real network write. Mocked tests exercise the complete request
sequence and the separately injected authorization-header boundary.

The protocol is:

1. `GET` the catalog. The response must be a valid catalog and return a strong
   ETag whose value is the lowercase SHA-256 of its canonical JSON.
2. `PUT` canonical VenuePackage bytes with `If-None-Match: *`, the full artifact
   SHA-256, and byte length. A matching ETag proves creation or an idempotent
   pre-existing object.
3. `PATCH` the complete validated catalog with `If-Match` set to the preflight
   revision. The response ETag must match the canonical proposed catalog.

The adapter fails closed on redirects, ambient cookies, non-HTTPS targets,
embedded credentials, invalid catalogs, weak or mismatched ETags, modified
package bytes, and compare-and-swap conflicts. Authorization can add provider
headers, but cannot override digest, content-type, or concurrency headers.

Real endpoint configuration, credential acquisition/storage, retry policy,
provider-specific upload protocols, signing, audit persistence, and cleanup of
unreferenced remote artifacts remain outside this mocked HTTP slice.

## Reference publishing service (Slice 9A)

The reference service is the first real HTTP counterpart to the transport
contract. It remains local, in-memory, and disconnected from the Studio UI.
Integration tests run it on an ephemeral loopback port and map the configured
HTTPS publication origin to that isolated server.

The service provides:

- public catalog and immutable VenuePackage reads;
- authorization-gated package and catalog mutations;
- package byte-length, artifact digest, semantic package, and content-hash
  verification;
- immutable `PUT` behavior with idempotent precondition responses;
- append-only catalog validation with no default-release promotion;
- a second compare-and-swap revision check immediately before commit;
- rejection of catalog releases that do not reference a package already stored
  by the service.

The real-HTTP regression suite proves successful publication, artifact
retrieval, idempotent replay, authorization failure, and concurrent publisher
conflicts. The service deliberately has no filesystem or cloud persistence, no
credential store, and no production deployment configuration.
