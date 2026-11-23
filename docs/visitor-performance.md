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
and follows the entry chunks' **static** imports, counts shared dependencies once, and sums UTF-8
bytes plus the per-file gzip sizes. Dynamic map/camera/worker downloads, CSS,
venue data and source maps are outside this startup-JavaScript measure.

The limits are **500 KiB uncompressed / 170 KiB gzip**. Importing CameraPreview,
the immersive session or Three into that static graph fails the build even
if it still fits the limits. Missing/unmeasurable static imports also fail.
The operator build is intentionally exempt. Review an actual bundle graph
before changing the public limits; do not increase them to hide an eager
import regression.

Measured on the same local public production build before/after deferring
CameraPreview:

- Main entry: 1,028.21 kB → about 435 kB raw; 299.57 kB → about 144 kB gzip.
- Camera code is a separate roughly 45 kB raw chunk; Three is shared by the
  map and immersive view in a separate roughly 551 kB raw chunk.

These are build bytes, not phone timing measurements. The map still needs
Three when opened, so the whole first-map download is not 58% smaller.
Physical-device startup timing, frame-time, GPU memory and battery profiling
remain open.

## Map graphics policy

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
