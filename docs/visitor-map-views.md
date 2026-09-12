# Visitor 2D/3D presentation

This bounded slice was moved ahead of the interrupted-IMU work at the user's
request. It changes presentation, not the localization or routing policy.

## Interaction and invariants

- **2D** is a top-down orthographic plan. Drag, arrow keys and two-finger pan
  move the map. Pinch, wheel and the existing buttons zoom.
- **3D** is a tilted, orbitable orthographic model (axonometric, not a
  perspective or AR camera). Drag orbits; Shift-drag, arrow keys and two fingers
  pan. The same venue geometry, route edges, markers and labels are reused.
- Switching eases only tilt. The world-space focus, normalized scale and map
  bearing are unchanged, including a reversal during an unfinished transition.
  Reduced motion snaps to the requested preset on the first rendered frame.
- Floors stay collapsed unless the visitor requests **Route overview** in 3D
  for a cross-floor route. The active floor remains at height zero and changing
  presentation never changes the checkpoint's floor.
- **Expand map** temporarily hides the directions sheet without unmounting it.
  **Show directions** restores it and keyboard focus. A new route automatically
  returns to directions rather than hiding new guidance.
- Camera-preview round trips preserve the camera presentation, scoped to the
  package hash. A venue change starts with the default plan. A page reload does
  not restore a camera session. The Inspector remains a separate operator tool.
- Route, instruction, arrival state and check-in remain owned by the journey.
  A camera target is a browsing position, never a measured visitor position.

## Rendering and recovery

Plan +X/+Y map to world +X/+Z, with world +Y used for elevation, so the default
plan is neither mirrored nor upside down. Route cylinders follow adjacent
graph points exactly. They do not smooth across junctions, join disconnected
visits to a floor, or replace a connector entry with the exit's coordinates.
Exploded floor heights and connector endpoints update together.

The WebGL context is checked before constructing the renderer. An unavailable
context leaves search and the existing written route usable. Context loss
pauses drawing, hides stale labels and shows a visible status; restoration
reuses the scene. Retry reconstructs from current journey inputs and saved view.
The first draw waits for those inputs, avoiding a flash of the default floor.
Scene teardown removes pointer, wheel and keyboard listeners and disposes mesh
resources and light-shadow render targets; failed capability checks do not
allocate a renderer.

## Verification

- Camera math tests cover top-down axes, orthographic scale, centre/bearing/zoom
  continuity, interruption reversal, reduced motion, elapsed-time interpolation,
  panning, snapshot isolation and resize/zoom bounds.
- Scene tests use real Three geometry with only the GPU replaced. They cover
  right-angle centre lines, revisited floors and listener teardown. All three
  failed against the actual pre-slice `HEAD` renderer, then passed after the
  implementation was restored. They do not claim jsdom performs layout.
- An additional shadow-target disposal regression failed before its cleanup
  call was added, then passed. The full code gate now passes **820 tests across
  82 files**, lint, types, all three venue hashes, replay, QR and public build.
- The complete operator-build browser suite passed **84/84 tests**, with no
  skips or retries. After the final shadow cleanup, the public-build map-view
  and offline suites passed **26/26**, including visitor-only shell isolation.
  The separate offline-install-failure suite was not rerun in this slice.
- The new production-browser round-trip test first failed on the actual prior
  UI because the 2D control did not exist. Browser coverage includes repeated
  switching, shared journey facts, pan/zoom continuity, a 320 px layout, expanded
  map/camera-preview round trips, focus restoration, reduced motion, actual
  WebGL context loss/restoration, missing WebGL and retry.
- Screenshots are generated for default 2D/3D and expanded 320 px views. These
  are synthetic venue/browser checks, not field or handset performance evidence.

Commands used for the final gates:

```text
npm run check
node scripts/runBrowserSmoke.js --workers=1
node scripts/runBrowserSmoke.js --public-build e2e/visitor-map-views.pw.ts e2e/offline.pw.ts --workers=1
```

An initial public-build command mistakenly selected `public-shell.pw.ts`, whose
current tests deliberately require operator tooling. It was stopped after those
expectations failed; the correct public shell contract is in `offline.pw.ts` and
passed in the final run above. No production behavior or assertion was weakened
to accommodate that test-selection error.

## Deliberately open

Physical-device frame-time/memory profiling, adaptive quality tiers, independent
route-clearance checks and real-user usability trials remain required. A stroke
following a graph edge is not proof that its full visual width stays inside every
surveyed corridor. The existing model furniture is illustrative, not surveyed.
The broader compact-sheet/cartographic redesign remains in phase 4. Automatic
tracking is still disabled; interrupted IMU continuity/reset semantics is next
after this slice is reviewed.
