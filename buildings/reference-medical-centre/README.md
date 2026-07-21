# Reference Medical Centre

This is a **synthetic two-floor compiler fixture**, not a surveyed building and not a navigation safety claim.

It exists to exercise:

- Explicit rooms, corridors, doors, and openings
- An accessible lift and stair-only alternative
- Public and restricted spaces
- Multi-floor POIs
- QR and image localization-anchor metadata
- Standard and accessibility reachability validation
- Deterministic package hashing

The source is compiled with:

```bash
npm run compile:reference
```

CI runs `npm run compile:check` to prove that `compiled/building.package.json` and `compiled/validation-report.json` match the committed source and compiler.

Replace this fixture with surveyed source data before reporting physical navigation results.
