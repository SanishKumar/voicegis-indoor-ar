# Visitor direction from a check-in sign

Status: approved direction, first implementation slice, 26 September 2026.
**Automatic sign-based heading is not implemented yet.** This separates the
delivered work from the calibration and measurement work still required.

## Contract

A QR payload continues to provide declared location/floor, not phone orientation.
User approval permits a **separate measured visual pose** to provide Visitor
heading. It does not turn authored `headingDegrees` into a camera measurement
and does not change the recorder/replay/evidence pipeline.

The anchor schema has position and heading, but no surveyed surface-normal
definition, mounting axes, printed marker size or survey provenance. Bundled
venues are synthetic; none have been relabelled as surveyed.

Pose estimation needs a camera model and corresponding image/object points;
planar poses can have competing solutions. See the primary
[OpenCV pose documentation](https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html)
and [IPPE author's implementation](https://github.com/tobycollins/IPPE).
The preview's assumed 55-degree FOV is **not** a calibrated camera model.

## Delivered

1. Both QR paths decode an owned frame and return corners, original/decode
   dimensions, video media time and monotonic copy time alongside the payload.
   Coordinates map back using actual rounded dimensions, not the CSS viewfinder.
   Copy time is explicitly **not exposure time**.
2. Native image-clockwise and jsQR code-relative corner orders remain distinct.
   The [Shape Detection specification](https://wicg.github.io/shape-detection-api/#detectedbarcode)
   does not establish surveyed mounting axes. Image top-left must not silently
   become the printed marker's top-left after rotation.
3. Scanning serializes decodes and ignores retired scanner results. Missing or
   malformed geometry still permits a valid location-only check-in.
4. Welcome and location-picker scans carry geometry into the accepted check-in,
   bound to its exact payload, anchor and venue revision. It is `unqualified`.
   Stale/future copy times and mismatches discard geometry, not position. Links
   have no visual candidate. Only small metadata remains in memory: no camera
   images, device IDs, uploads, persistence or recorder observations.
5. Start AR and Re-align no longer implicitly supply the route bearing as camera
   heading. Floor confirmation never changes yaw. Unknown direction after floor
   confirmation gets a `heading` placement state and reachable Leave AR action;
   the session draws no route and counts no pose displacement.
6. An explicitly **manual** fallback remains: check the map, face along the route,
   tap “I'm facing the corridor”, then start AR. It uses physical tracker progress
   rather than a preview position. Same-feed yaw carries turns, including 180°
   away from the route. Readings older than 100 ms, mismatched epochs and camera
   pitch at least 70° from horizontal are refused. These are provisional guards,
   not a measured camera/IMU synchronization or accuracy bound.

## Approximate sign direction (MVP) — 26 September 2026

Agreed as an interim step before the calibrated solver below. It is
**approximate** and labelled so wherever it is shown.

- An anchor's `headingDegrees` means the plan bearing the sign's printed face
  points: its outward normal, away from the wall. Pilot venues must set it from
  the sign as mounted; the bundled synthetic values are authored, not surveyed.
- The scanner asks the visitor to face the sign squarely. At an accepted scan,
  the orientation reading nearest the decoded frame (within 150 ms, camera within
  40° of level) is paired with the sign's facing reversed: that is the camera's
  approximate plan bearing at that yaw. A link, a missing reading or a steep
  camera sets no direction. It lives in memory with the check-in only.
- One orientation feed runs for the page, from app start, so the scan and the
  camera view and AR read the same yaw zero. Any loss of continuity (hidden page,
  readings stale for 500 ms) starts a new epoch and the sign direction is
  dropped; the visitor scans again or aligns by hand.
- The camera view draws from it as source `sign` and says "Direction from the
  sign · approximate"; a manual "I'm facing the corridor" overrides it. AR is
  placed from it at floor confirmation, whichever way the phone points, and
  then gives broad turn cues (left, right, turn around) from the session's own
  camera heading. No corridor snapping and no claim of precise alignment.
- Untested on a handset: whether orientation readings continue while Chrome
  starts an immersive session. A pause over 500 ms would drop the direction at
  placement; the field test log records it.

## Remaining implementation order

### A. Survey and camera-model inputs

Define versioned metadata for the physical QR's outward normal in the Visitor
plan frame, mounting axes, printed square size (excluding its quiet border),
floor and survey provenance/uncertainty. Do not migrate existing headings by
assumption. Camera calibration must bind the actual lens, resolution, crop,
distortion model and optical-axis convention. Camera/lens changes invalidate it.
Physical size enables metric pose; it does not replace intrinsics for rotation.

Ordinary camera video currently supplies no qualified intrinsics. Compare
explicit camera calibration with capability-gated
[WebXR raw camera access](https://immersive-web.github.io/raw-camera-access/),
which associates images with an XR view. An immersive session alone does not
provide a calibrated model for ordinary video or access to its composited image.

### B. Calibrated visual-pose solver

Canonicalize corner orientation, solve competing planar poses, and reject
ambiguity, tiny/clipped/blurred codes, inconsistent reprojection, implausible
distance, bad mounting and excessive uncertainty. Test oblique views, rotated
codes, both sides of the route, distortion and noise with independent fixtures.
Keep unknown outcomes explicit; do not immediately trust a noisy single frame.

### C. Observation-time sensor continuity

Pair camera exposure with attitude in a common clock. Copy/decode completion
time is insufficient, particularly for a stalled video frame. Maintain continuity
across scanner → map → camera without automatic motion-tracking enrollment.
Reject background/resume, sensor reference changes and stale observations. Never
carry an old feed's yaw zero into a new feed because both call their first epoch
`1`. Heading must age as well as refresh.

### D. Map, camera and XR handoff

Publish qualified camera-forward heading separately from travel direction,
bound to the venue revision and continuity lifetime. Register the XR frame with
a time-matched observation, not the facing at Start AR/floor confirmation. A route
behind the camera stays behind it; provide an off-screen turn cue.

Compass fallback requires verified camera axis, accuracy, north reference,
venue-north survey and magnetic correction. Relative alpha and the current
unsurveyed `northOffsetDegrees` do not qualify. Unknown means map/manual fallback.

### E. Verification and pilot

Automate scan/turn/enter-AR/confirm-floor/turn-around, delayed results, opposite
initial directions, route previews, permissions, visibility, camera changes,
storey changes and recovery. Then verify a calibrated phone in a surveyed
corridor. Synthetic success is not an accuracy claim. This does not fix motion
acquisition, make a synthetic plan match another building or avoid obstacles.
