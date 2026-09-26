# Visitor coordinate and heading boundary

Phase 2 slice B, 11–12 September 2026. This is a tested software contract and a
camera-preview correction, not a claim of working continuous positioning.

26 September update: user-approved [visual sign heading](visual-marker-heading.md)
is a separate measured-pose path, not a reinterpretation of the QR payload.
Its first slice preserves unqualified frame geometry and removes implicit
route-facing XR alignment. The solver and calibrated sensor handoff remain
unfinished; the existing evidence/recorder contract below is unchanged.

## Coordinate conventions

| Frame | Axes and units | Meaning of a heading |
| --- | --- | --- |
| Visitor plan/routing | XY metres, +X right, +Y down; elevation up | Clockwise from plan-up (-Y) |
| Existing replay filter | XY metres, +X right, +Y up; elevation up | Zero along +Y, 90 along +X |
| True-north reading | Degrees clockwise from true north | Must state which device or travel axis was measured |
| Magnetic-north reading | Degrees clockwise from magnetic north | Requires a declared magnetic-to-true correction before true-north alignment |
| Relative orientation | Device-relative reference with arbitrary zero | Not a north or map bearing without calibration |

`src/navigation/coordinateFrames.ts` defines the Visitor-side boundary.
`planBearing` returns null for coincident/invalid points, not an invented north.
The existing routing API still carries numeric placeholders on non-directional
steps; the preview excludes vertical, arrival and zero-distance instructions
from heading comparison. Routing calculations themselves are unchanged.

`reflectPlanFilterPosition([x, y])` returns `[x, -y]` and is its own inverse.
With that reflection, a plan bearing can be used by the legacy filter without
changing its numeric heading. Tests send each cardinal direction through the
actual router and a reflected filter stride and recover the expected plan point,
with floor and elevation unchanged. This bridge is **not connected to recordings
or live positioning**. A future adapter must transform all related positions,
route geometry, velocities and covariance consistently, not only the marker.

## Heading is a separate observation

A `HeadingReading` explicitly carries its reference frame, measured axis,
source, uncertainty and occurrence timestamp. A device-top direction, camera
forward direction and travel direction are different quantities. A QR payload
supplies none of them. Visitor check-ins remain position/floor inputs; the
contract has no QR-heading source.

`resolvePlanHeading` refuses unknown, relative-only, stale, future-dated,
wrong-axis, unquantified/over-limit uncertainty and wrong-venue readings. A
venue-plan calibration is bound to the exact `venueKey` (including its package
revision), not reused in a different venue. Conversion is pure and retains
the supplied source and alignment provenance IDs; it does not authenticate
those declarations or turn them into surveyed evidence.

An explicit `NorthAlignment.northBearingInPlanDegrees` means the clockwise angle
from plan-up to **true north**. Thus:

```text
true heading = magnetic heading + east-positive declination
plan bearing = true heading + north's bearing in the plan
```

Every angle is wrapped to [0, 360). The declared accuracy bounds of the reading,
declination and north alignment are added conservatively, without assuming
independent errors. Cardinal and rotated-map fixtures exercise both signs of
the rotation and wraparound.

Existing `northOffsetDegrees` metadata is **not automatically promoted to this
alignment**. Its schema does not establish the heading axis, survey provenance
or accuracy needed by this boundary. The -12° and 18° test rotations do not
validate the synthetic venues' physical orientation. A future venue contract
and field calibration must settle that provenance before live heading guidance.

## Browser preview behavior

The previous preview subtracted any finite alpha from 360 and directly compared
that result, or a WebKit compass value, with route bearings. Regression tests
first reproduced false “Aligned” labels for both relative orientation and an
uncalibrated magnetic reading, plus acceptance of an invalid negative compass.

The corrected adapter follows the distinction between arbitrary relative and
Earth-referenced orientation in the [W3C orientation specification](https://www.w3.org/TR/orientation-event/).
The full rotation and a known measured axis are necessary to interpret camera
direction; `absolute: true` and alpha alone do not establish camera alignment.
Apple documents `webkitCompassHeading` as magnetic-north-relative and negative
values as invalid in its [compass heading reference](https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804777-webkitcompassheading).

The preview now shows **Relative only**, **Uncalibrated**, **Unavailable**,
**Stale** or **Paused** instead of fabricating a directional claim. No currently
supported browser reading has the complete calibration needed to produce a
known camera-forward plan heading, so the ribbon remains screen-aligned. The
existing “Enable heading” action enables diagnostic readiness only. A visitor
can disable it, and can always return to the plan. It does not activate tracking.

Orientation occurrence timestamps must share `performance.now()`'s monotonic
millisecond origin. Wall-clock, negative, non-finite and future timestamps are
refused, not repaired into fresh measurements. A 2-second UI freshness limit
with a 250 ms watchdog clears stalled telemetry; it is not a calibrated drift
or maneuver-advancement tolerance. Backgrounding clears readings and listeners
and requires renewed opt-in. Late permission grants cannot restart a closed
or backgrounded preview. Permission denial has no effect on map navigation.

## What remains

- Slice C now removes authored marker heading from checkpoint derivation and
  introduces position-only recording 0.2 with independent calibration and
  unknown-heading observations. See [the migration](position-only-recording.md).
  The raw capture schema still needs a measured calibration/pose event; neither
  adapter is connected to Visitor movement, and current captures cannot publish
  accuracy under current processor 0.6 / policy 0.4.
- [Slice D](imu-continuity.md) implements deterministic IMU continuity and recorder
  visibility boundaries. A real live-session watchdog remains required; the
  preview watchdog is not a positioning session.
- [Slice E](route-matching-safety.md) adds ambiguity, progress and floor-refusal
  gates. Whole-venue off-route detection and verified connector traversal remain
  open; a confidence value cannot establish a stair/lift transition.
- Survey a venue and validate calibration, carriage, accessibility and accuracy
  on actual phones. Synthetic event dispatch and Chromium layouts do not verify
  Safari sensors, camera pose or real-world direction accuracy.

Slice B did not change capture schemas, evidence versions, venue artifacts or
sensor admission. The subsequent slice C changes recording and evidence versions
as described above; raw captures and venue packages remain unchanged.
