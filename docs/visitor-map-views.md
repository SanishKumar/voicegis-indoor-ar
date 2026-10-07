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
- Opening or closing the overview reframes: one floor's leg and the whole trip
  are different pictures, whoever chose the view. While it is open the camera
  frames every floor the route crosses and does not follow the marker; closing
  it gives the marker the camera back. The destination is named in the
  overview even when it is on another floor than the one in hand.
- In a venue with grounds the map is one of several that connect: the grounds
  and each building. The one open follows the visitor's marker through doors,
  and the floor buttons are the floors of the building it is in. See
  [the maps connect](design-system.md#the-maps-connect).
- A trip that ends brings the camera home: to the visitor's last known place,
  north up, fitted to the room the map has once the sheet has gone. A walk
  otherwise leaves it close in and turned to its last heading.
- **Expand map** temporarily hides the directions sheet without unmounting it.
  **Show directions** restores it and keyboard focus. A new route automatically
  returns to directions rather than hiding new guidance.
- Camera-preview and display-retry round trips preserve the camera presentation,
  the explored building, and the marker's last observed building. This memory
  is scoped to the package hash and current check-in/chosen start. A newer scan
  (even of the same sign) or a changed start takes precedence over browsing.
  A venue change starts with the default plan. A page reload does not restore a
  camera session. The Inspector remains a separate operator tool.
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

The September 15 smoke repair places the recovery status/action in the visible
directions panel's scroll flow when that panel is open, including expanded route
details. Expanding the map places it back over the unobstructed map. Retry is no
longer underneath a higher-stacking directions card. A 320 px header refinement
keeps Cancel inside the viewport. Recovery still belongs to the same scene owner;
it does not reset the journey or enable tracking.

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

The verification counts above describe the original presentation slice, not the
current product. Adaptive quality, authored route-clearance checks and automatic
tracking have subsequently been implemented. Current software and physical
validation limits are recorded in [visitor readiness](visitor-readiness.md).
Physical-device frame-time/memory profiling and real-user usability trials
remain required. Authored clearance is not proof of surveyed traversability;
the model furniture is illustrative, not surveyed.

## Connected campus and operator review — 5 October 2026

An explicit building exploration owns the camera while its fit eases into place;
new movement in the same physical building does not steal it. Recenter restores
both the marker's building scope and guidance ownership. A known checkpoint
keeps other buildings closed and selectable, rather than opening every roof at
close zoom. Campus returns from any viewed storey to the grounds without
changing the visitor's physical location. Room-selection highlights restore
their original colours across floor changes.

The operator Inspector now frames the complete venue at its actual viewport
aspect, with proportional clipping and orbit limits. Authored campus grounds
are reused in the semantic cutaway, with building envelopes hidden so rooms
remain inspectable. Screen-space labels stay readable; a measured collision
pass prioritises the destination, connectors and entrances, and hides names
that overlap or leave the viewport instead of shrinking them. Studio drafts
and local compiled previews survive tool
switching in bounded, content-hash-keyed memory. Reloading/closing the tab clears
that memory. Activation confirmation and publishing authority are never saved;
stale compiled candidates remain blocked.

Deterministic regression tests cover the former continuity, camera, selection
and draft-loss failures. Production-browser flows cover door transitions,
camera/retry round trips, upstairs-to-campus navigation, keyboard interaction,
cross-building and cross-floor journeys, and the Studio compile/activate/visitor/
rollback cycle. These are synthetic software checks, not handset/venue accuracy
or AR qualification.

Final verification: `npm run check` passes **1,833 tests across 144 files**, lint,
types, all four venue hashes, replay, QR generation and the public build. The
affected operator-build browser suite passes **114/114**, across desktop and
mobile Chromium, without skips or retries:

```text
node scripts/runBrowserSmoke.js e2e/campus.pw.ts e2e/operator-campus.pw.ts e2e/visitor-map-views.pw.ts e2e/visitor-journey.pw.ts e2e/layout.pw.ts e2e/closure-recovery.pw.ts e2e/keyboard-accessibility.pw.ts
```

The complete browser suite, separate offline installation/sub-path suite and
handset sensor tests were not rerun in this slice. Passing these flow checks is
not a claim that live positioning or AR alignment is physically qualified.
