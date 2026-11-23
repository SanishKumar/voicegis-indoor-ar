# Design system

## Visitor screens

Inter is bundled with the app. Room names use a heavier weight than their building
and floor. The welcome screen, destination list, starting-point picker and route
details use dark text on warm white. Dark teal controls stay visible when a visitor
pans the map over a pale roof or a busy ward. Blue identifies the route, position
and selected destination.

The visitor palette and surface styles live in `src/components/visitorArchitecture.css`.
The workbench has its own blue navigation rail on desktop and a bottom dock on phones.
The public visitor build opens directly into the venue.

### Finding a place

The directory starts with a destination search and a short list of places.
Each row shows the place name, building and floor. Visitors can switch venues,
browse the map, select a familiar starting place, or scan a check-in sign.
Search and start-location controls share the same place names and icons.

### Layout

On a phone the instruction sits above the map and the trip sheet sits below it.
The handle folds the sheet while preserving the current route and selection.
On desktop the directions sit beside the map. The layout measures the space
taken by the panels and keeps interactive map labels clear of those rectangles.

## The models

The campus and the indoor cutaway share the venue coordinate system.
The roofline, paving, glazing and landscaping are architectural illustrations.
The visitor enters a building through a mapped doorway and the scene opens
around the floor in use. A building crossed by a route becomes translucent.

### What is in a room

Ward beds have rails, bedside cabinets, curtains and IV stands. Waiting areas
use linked seats, offices have desks and monitors, and imaging rooms have
scanners. The furnishings follow the room's use and available space. Fit is
checked against doors, destinations and route segments before placing an item.
The compact meshes adapted from the supplied hospital model are instanced
across rooms. [Model credits](../src/map/clinicalFurniture.LICENSE.md).

### A site with more than one building

Meridian's main hospital has curved glazed wings, elevated planted light courts
and a central roof lantern. The emergency entrance faces its own approach.
Timber pergolas distinguish the wellness pavilion. Ground markings, paths,
parks and entrance canopies make the approach readable from above.

#### The maps connect

A venue with grounds is several maps that share one drawing, the way a game
has an outside and interiors: the grounds, and each building. One of them is
open at a time, and the rule for which is the rule a game uses. It is the one
the visitor is in.

| What happens                              | The map                                                              |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Nobody is on the map, or they are outside | The grounds: every building closed, with its name on it              |
| The visitor's marker walks in at a door   | That building opens; its name comes up: _Entering Main Hospital_     |
| It walks out again                        | The building closes behind it: _Leaving Main Hospital · The grounds_ |
| A sign is scanned indoors                 | That building is open, round the sign, up to 30 m each way           |
| A building is pressed from outside        | It opens, for looking at: _Inside Main Hospital_                     |
| The floor changes                         | The floor is named under its building's name                         |
| The trip ends                             | Home: where the visitor is known to be, the right way up             |

What is shown round the map follows from which map it is:

- **Floors belong to a building.** The floor buttons are the floors of the
  building the map is in, and a building of one storey has none. Out on the
  grounds there is nothing to choose: "Level 1" is not a floor of a garden,
  and of three buildings it would not say which. A route offers the floors it
  crosses, as it always has.
- **Walking past a building does not open it.** With nobody on the map, any
  building opens when the camera comes within about 70 m, fading from 115 m.
  With a visitor on it, only the building they are in does: the others stay
  closed however close the walk passes, and the camera is drawn back out of
  doors to take in the buildings a walk runs between.
- **The name of a map is said once, on the way in.** It comes up over the
  part of the map nothing covers for a couple of seconds and is announced to
  a screen reader. It is never in the way of a press.
- **A view of the site is fitted to the room the map has.** A trip's sheet
  goes away a moment after the trip does; the home view is fitted again once
  it has, and not left cropped to the strip that was showing.

The scene decides which map is open (`getZone`, `onZoneChange` in
`venueScene.ts`); the map component only shows what follows from it.

**A trip between buildings is seen whole in the route overview.** A route
from a room upstairs in one building to a room in another is three things at
once: a leg on one floor, a way down, and a walk across the grounds. In 3D,
_Route overview_ stacks the floors it crosses and frames all of it: the floor
in hand is solid, a floor only passed through on the stairs is a ghost, and
the grounds stay readable beneath, because that is where the walk between
buildings is. The trip's end is named wherever it is, and while the overview
is open the camera holds the whole trip and does not go off after the marker.

Sixty metres across is inside the distance at which the roofs come off, so
coming in to a visitor always arrives among the rooms, on a phone as on a
desk. The _Campus_ control (_Reset the map view_) goes back out to the whole site and _Recenter_
comes back in. A view the visitor chose and came back to is restored and left
alone.

**The checkpoint is never hidden.** It is painted over everything, so from
outside it shows through the roof of the building the visitor is in; it is
never drawn smaller than 16px across; and labels are placed round it, not on
it. A sign hangs at a place, so the checkpoint, that place's name and from
outside the building's name all want the same spot.

### Labels on the model

Four kinds, and they look different because they are different:

| Kind            | Looks like                | Means                                        |
| --------------- | ------------------------- | -------------------------------------------- |
| A place         | White tag, blue dot, 13px | Somewhere you can go. It can be tapped       |
| An area         | Paler, smaller tag, 12px  | The name of a room or corridor               |
| The destination | Dark tag, white dot, 14px | Where the route ends. Always placed          |
| A building      | Larger white tag, no dot  | A building seen from outside. Press to go in |

They are light because a dark tag on every room turned the model into a wall
of labels with a building behind it. The collision pass decides which are
shown; a label is either readable in full or not drawn.

Building tags are real buttons, at least 44px high, named _Explore [building]_
for assistive technology. Enter/Space opens the building and hands focus to the
map. Labels that lose their place are hidden from focus and hit testing.
Closed panels cannot scroll the enclosing map stage when a control is focused.
The active destination stays named in the exterior overview. Building and
destination tags are constrained to the viewport before collision checks, with
extra vertical placements to clear phone controls. Panned-away features are
not pulled back onto the visible map.

The campus is a lightweight navigable architectural illustration, not a
photorealistic render or a surveyed hospital. The example package demonstrates
cross-building and multi-floor journeys; real-world accuracy still requires a
measured venue, installed signs and handset validation.

### Tapping a place

A place answers a tap on its marker, on its label, anywhere within 26px of its
marker, or anywhere in the room it is in. Markers have a minimum 44 px touch target. A mouse pointer changes over interactive places.

### Where the map's controls go

One block at the end of `src/components/visitorJourney.css` places all of
them, and the rule is that no two groups share a corner.

|                 | View switch                     | Floors           | Zoom                         | Location note    |
| --------------- | ------------------------------- | ---------------- | ---------------------------- | ---------------- |
| Wide, browsing  | top right                       | under the switch | bottom right                 | top left         |
| Wide, journey   | top left, beside the directions | top right        | bottom right                 | -                |
| Phone, browsing | top left                        | top right        | a row above the search field | under the switch |
| Phone, journey  | top left, under the banner      | top right        | a row above the sheet        | -                |

The view switch (2D / 3D) is a segmented pill. Opening the camera and changing
the graphics are actions, and are separate buttons beside it. The floor stack
is the one group whose size is not known, so it is the one that scrolls when
the map is short. Labels are kept out from under all of them.

## Accessibility

Buttons use visible focus rings and have at least 44 px touch targets. Pressing
a building label opens it and moves keyboard focus to the map. The mobile
sheet handle supports touch, keyboard and swipe. Reduced-motion preferences
shorten camera transitions. Directions and recovery messages remain available
as text when the 3D renderer or camera is unavailable.
