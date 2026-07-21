# ADR 0004: Verify packages before atomic activation

- Status: accepted
- Date: 2026-07-22

## Context

An offline building package can be present in storage and still be incomplete, corrupted, or different from its manifest. Replacing the active package pointer before verification could strand a client without a known-good map. Updating the package record and activation metadata in separate transactions could also leave them inconsistent after interruption.

## Decision

The browser package registry reproduces the compiler's canonical JSON and SHA-256 content hash before install, activation, active-package reads, and rollback. IndexedDB stores immutable package records by `buildingId:contentHash` and one activation record per building.

Activation writes the candidate package and active/previous pointers in one transaction. A failed verification makes no activation change. Rollback verifies the previous package before atomically swapping the active and previous hashes.

The bundled reference package bootstraps the registry. Cache failure is reported but does not prevent the bundled navigation runtime from working.

## Consequences

- Corrupted updates leave the last known-good activation intact.
- Rollback is a defined state transition rather than a destructive overwrite.
- The status bar can show the verified active hash.
- Remote download, signature trust, storage quotas, multi-tab coordination, and runtime hot-swap from a non-bundled active package remain separate work.
