# Visitor startup and deferred views

The public shell now imports the camera view only when a visitor opens it.
The existing lazy map remains separate. Tracking, orientation and journey
state stay in the shell, so loading a view does not start another tracker,
discard the sign heading, or reset the route.

## Loading and recovery

- A slow camera download shows a focused loading message and **Exit to plan**.
  Exiting does not request camera access or open it later in the background.
- A failed view import is contained locally. Camera failure leaves an exit to
  the same map journey. Map failure leaves check-in, search and written
  directions mounted; its recovery message moves into the directions sheet
  so the controls cannot cover it.
- A failed module import is cached by the module loader/React. A fake retry
  cannot repair it. **Reload app** is explicit and warns that reloading
  restarts the journey; camera users can return to the map without reloading.
- Focus moves from the camera loading/error message into the loaded view, and
  back to written directions on exit from a journey.
- The public offline installer still precaches every deferred chunk using
  its exact build hash. A cold offline page can open a camera view never
  opened online. This does not reduce the offline download's total size.

## Build contract

`scripts/visitorStartupBudgetPlugin.js` runs in every public production build,
including `npm run check` and the public browser runner. It follows all entry
chunks' **static** imports, counts shared dependencies once, and sums UTF-8
bytes plus the per-file gzip sizes. Dynamic map/camera/worker downloads, CSS,
venue data and source maps are outside this startup-JavaScript measure.

The limits are **500 KiB uncompressed / 170 KiB gzip**. Importing CameraPreview,
the immersive session or Three into that static graph fails the build even
if it still fits the limits. Missing/unmeasurable static imports also fail.
The operator build is intentionally exempt. Review an actual bundle graph
before changing the public limits; do not increase them to hide an eager
import regression.

The former eager CameraPreview import was temporarily restored to test the
actual build: it fails with the offending AR/Three modules listed. Restoring
the lazy import passes. Offline-worker generation runs after a successful
bundle write, so a failed build cannot mask that error or precache stale files.

Measured on the same local public production build before/after deferring
CameraPreview:

- Main entry: 1,028.21 kB → about 435 kB raw; 299.57 kB → about 144 kB gzip.
- Camera code is a separate roughly 45 kB raw chunk; Three is shared by the
  map and immersive view in a separate roughly 551 kB raw chunk.

These are build bytes, not phone timing measurements. The map still needs
Three when opened, so the whole first-map download is not 58% smaller.
Physical-device startup timing, frame-time, GPU memory and battery profiling
remain open, alongside the pending navigation/AR handset tests.

## Regression coverage

The build tests cover transitive imports, shared chunks/cycles, dynamic
exclusion, eager AR/Three leakage and both size limits. Production browser
tests hold or reject view-chunk requests, verify route preservation and
keyboard focus, check recovery controls at 320 px, and open the deferred
camera from a fresh offline page with the HTTP cache cleared. Sensor/sign
journeys remain separate tests; a smaller entry is not localization evidence.

## Map graphics policy — 30 September 2026

The Visitor map now offers **Graphics detail → Automatic / Full detail / Low
detail**. Full retains the existing shadows and caps resolution at DPR 2.
Low caps resolution at DPR 1 and disables shadows. At DPR 2 this reduces the
draw buffer's pixel count by 75%; it is not a measured frame-time improvement.
Route/room geometry, labels, uncertainty and location are never simplified.
This policy does not alter the immersive AR renderer or the operator inspector.

Automatic starts low when an optional valid device hint reports at most 2 GiB
memory or four CPU cores. Missing/invalid hints do not trigger it. These are
coarse browser hints, not GPU benchmarks. The visitor can override them.

Feedback considers only consecutive **drawn** visible frames. A window needs
at least 1.8 seconds and 20 frames, with at least 70% slower than 40 ms, before
switching down once. Idle RAFs, zero-size views, hidden-tab gaps and durations
outside 4–250 ms reset the window. One expensive first frame and occasional
stalls cannot trigger it. There is no automatic oscillation back up; selecting
Full overrides feedback, and selecting Automatic again restarts the policy.
These thresholds are provisional, not a handset performance qualification.

The selection and an automatic downshift survive map/camera remounts and
graphics retries in the package-hash-bound view memory. Reloading the app or
changing packages resets that memory. It is not persisted or uploaded. Opt-in
field reports log only graphics-state changes, never every frame.

When switching low, existing light-shadow targets are disposed and references
cleared; switching full allows fresh targets. DPR changes update resolution
without reframing the journey. The disclosure has 44 px controls, pressed-state
labels, Escape/focus return, and stays usable at 320 px. Its footprint is also
included in map-label collision avoidance.

Pure-policy tests cover sustained feedback, gaps/idle/stalls, manual override
and memory. Real Three scene tests with a replaced GPU cover unchanged route
geometry/camera/progress, actual target disposal, DPR changes and one-time
feedback notification. Production browser tests exercise hint selection,
drawing-buffer size, controls and focus at 320 px, repeated shadow toggles and
journey/view/graphics preservation across a camera-view visit.

### Map-graphics checks completed

- `npm run check` passes: lint, types, **1,545 unit tests in 124 files**, all
  venue/replay/print-sheet checks and the public build. The static entry
  remains 424.4 KiB raw / 138.6 KiB gzip, within its existing budget.
- **66/66** production-browser cases pass across desktop/mobile for graphics,
  map views, journeys, camera alignment, AR floor placement and offline use.
  After screenshot review found floor controls covering the disclosure's
  right edge, its layering was fixed and whole-option hit tests were added.
- **14/14** affected public browser cases pass after the final layering,
  Escape/outside-dismiss and low-detail context-restoration changes.
- **10/10** graphics/deferred-view cases pass in the operator build used by
  regular browser CI. An initial outside-click test tried the zoom button
  behind the open disclosure in the shorter operator viewport; it now uses
  the visible 2D control, preserving dismissal/focus assertions. That final
  graphics case also passes **2/2** in the public build.
- No full operator-browser-suite, hosted CI or physical-device performance
  result is claimed. All changes remain local pending review.

### Startup/deferred-view checks — preceding slice

- `npm run check`: lint, types, **1,525 unit tests across 123 files**, all
  venue/replay/print-sheet checks and the public build pass.
- Public browser coverage: both screen sizes for journeys, AR floor placement,
  camera alignment, sign-derived walking, map views and offline recovery.
  An existing idle test initially accepted the old settled 2D frame while
  switching to 3D; it now waits for 3D before checking settling. A new recovery
  test initially sampled progress before the map frame published it; it now
  waits for the requested advance. Neither product assertion was relaxed.
- The affected idle/loading/recovery tests pass **16/16** with two repetitions
  on each screen size. The new loading tests also pass **6/6** in the operator
  build used by the default CI browser job.
- The GitHub Pages-style sub-path build installs and cold-reopens offline:
  **1/1** targeted browser test passes after the worker-hook change.
- The old eager camera import fails the actual public build; the restored
  implementation passes. No full operator-browser-suite or handset pass is
  claimed by these targeted runs.
