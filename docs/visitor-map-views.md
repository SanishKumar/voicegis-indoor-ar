# Visitor 2D/3D presentation

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

## Mobile panels

Below 900 px, map and camera detail panels have a shared **Less / More** handle.
Tap it, press Enter/Space, or swipe vertically on the handle. Folding is
presentation only: it does not restart a journey, change a location, stop
tracking or clear a query. A new destination resets its panel to expanded;
desktop layouts show their full contents.

Search, destination details and the start picker release the background map
and keyboard focus trap while folded. Their close controls remain reachable.
Directions retain the trip summary, next/previous controls, tracking status,
warnings and recovery actions. Camera and immersive AR retain their primary
action, floor confirmation/recovery and exit controls. The operator Inspector
and Studio validation panel follow the same interaction without discarding
the selected space or draft. Full-screen onboarding and the QR scanner retain
their existing close/back flows; they are not map detail sheets.

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

When directions are open, the display recovery message and **Retry** appear
inside the scrollable directions panel. Expanding the map moves the recovery
controls onto the map. **Cancel** remains reachable at 320 px. Retrying the
display preserves the journey and the visitor’s tracking choice.

## Connected campus and operator views

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

The 3D furnishings are an illustration of each room’s use. Deployment to a real venue requires surveyed geometry and a review of the routes on site.
