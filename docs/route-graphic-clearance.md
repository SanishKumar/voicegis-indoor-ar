# Authored route-graphic clearance

Implemented locally, 1 October 2026. This is a display-geometry safeguard,
not obstacle detection, positioning qualification or an accessibility audit.

## Contract

`calculateCompiledRoute` evaluates the selected route against the same compiled
package used by the routing worker. A structured-cloneable `displayClearance`
record identifies the package hash, selected profile, authored-geometry basis,
0.70 m graphic envelope, result and source-specific issues. It does not change
venue hashes or add guessed survey measurements.

- Missing graph edges, mismatched node coordinates/floors, centerlines outside
  their owning space, malformed floor transitions or policy inconsistencies
  reject the route. Such a path does not become written guidance either.
- A valid centerline with insufficient **graphic** clearance keeps its written
  instructions and route receipt, but withholds the 2D/3D route tubes and camera
  floor graphics. The visitor gets an explanation and can still inspect the
  instructions, change destination/profile, or end the route.
- A checked envelope is not a promise of safe wheelchair passage. The profile
  respects the package's declared accessibility/restrictions; this change does
  not invent body dimensions, turning circles, door operation or slope limits.

The graphic envelope is conservative: a continuous swept disc of radius
0.35 m, including endpoints and turns. It contains the map tube's 0.26 m radius
and the ordinary camera ribbon's 0.32 m half-width. It can withhold a narrower
graphic that might individually fit; it does not silently shrink the route or
route somebody through another space.

## Walls and openings

Every planar graph edge must stay inside its authored owning polygon. Segment
containment splits at **all boundary intersections**, including collinear
overlap endpoints, rather than sampling points at fixed distances. Clearance
uses continuous segment-to-wall distances, so a small notch between samples is
not skipped.

Adjoining space polygons do not imply an open room. Walls remain solid except
for a portal actually traversed by the selected path between its two declared
spaces. An opening is derived only when those spaces have a common straight
boundary at the portal, with unambiguous direction and enough shared boundary
for the declared width. An ambiguous corner or offset portal withholds graphics;
no wall normal is guessed. Collinear authored wall subdivisions are supported.

Only selected-route spaces/portals contribute to the footprint domain. This is
deliberately conservative near unused openings. Illustrative desks, beds,
plants and other scene furniture do not become routing constraints.

## Camera and AR footprints

The ordinary camera painter now projects metric floor rectangles and chevrons,
instead of widening a projected centreline in screen pixels. Rectangles end at
each exact turn; there is no smoothed/mitered shortcut through the corner. They
are clipped at the camera near plane and stop at a floor transition. Camera
height/FOV and position/direction are still provisional: this remains an
**estimated overlay**, not a measured floor or registered building geometry.

Both camera renderers additionally check full chevron footprints and the
destination disc. XR checks a conservative box around the outlined 0.70 m
chevron, including its 0.475 m tail and 0.25 m tip. The destination disc uses
its 0.45 m radius. Shared dimensions drive both the renderer and the checks,
so changing a glyph cannot silently leave its footprint test behind. A glyph
may be omitted at a tight corner even when the route envelope passes; other
glyphs and physical tracking continue. The view explains
that omission. Pixel glow is decorative, not certified metric geometry.

Floor changes are connector schematics, not floor ribbons between storeys.
Nothing in this contract proves real-world AR registration, detects a table,
provides depth occlusion, or avoids a newly observed obstacle.

## Automated coverage

- Geometry fixtures: narrow corridor/door, unused opening, shared-wall crossing,
  disconnected rooms, forged coordinates, ambiguous portal corner, a tiny
  concave notch, a wall enclosed inside a glyph, outlined tails at corners,
  destination-ring clearance and accessibility/restriction declarations.
- Routes to public destinations in all three synthetic packages, on standard
  and step-free profiles; worker-transferable clearance evidence.
- Rejected centerline versus written-guidance fallback for graphic-width failure.
- Metric camera projection/near clipping, rejected footprints, and real XR
  frames that omit glyphs without changing measured progress.
- Visitor notice, disabled AR start with a reachable exit, and production-browser
  2D/3D route continuity plus an injected worker-result width-failure scenario.

These tests qualify the software contract, not any real venue or handset.

Local verification: `npm run check` passes lint, types, 1,601 tests in 127 files,
unchanged compiled/replay/QR artifacts and the public build. The final public
build passes 76 targeted Chromium browser cases on desktop and phone-size
viewports (clearance, camera/AR, journeys, map views/graphics, offline and lazy
view recovery). No hosted CI, full operator suite or physical device result is
claimed. Changes remain local and uncommitted.
