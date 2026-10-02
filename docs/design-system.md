# Design system

How the app looks, and the rules a new screen has to follow. The tokens live at
the top of `src/index.css`; the fonts are declared in `src/styles/fonts.css`.

## The idea

A sky, with the interface floating in it.

Behind everything is one fixed picture: a blue sky that warms towards the
horizon, with a bank of cloud low down. On top of it the interface is glass -
panes with a blue tint, a thin light edge and white type, blurring whatever is
behind them. The building model is drawn the same way: translucent floor plates
the sky shows through, white walls, blue shadows. The one solid thing on any
screen is the white button for the next step, and the one saturated colour is
the route.

Panes float. They stand a few pixels in from the edges of the screen and from
each other, with rounded corners, so the sky and the model are visible around
and between them. Nothing is a bar running edge to edge.

## The sky

`body::before` in `src/index.css`: a generated cloud layer over a gradient, with
a warm glow low on the horizon.

| Token          | Value        | Where                                     |
| -------------- | ------------ | ----------------------------------------- |
| `--sky-zenith` | `#23539f`    | Top of the screen, held for the first 12% |
| `--sky-high`   | `#3f77c6`    | 40%                                       |
| `--sky-mid`    | `#6f9fda`    | 64%                                       |
| `--sky-low`    | `#a9c6e8`    | 84%                                       |
| `--sky-haze`   | `#e0dcea`    | Bottom                                    |
| `--sky-glow`   | peach at 90% | A radial light low and right              |

The clouds are `src/styles/sky-clouds.webp`. They are drawn, not photographed:
`node scripts/renderSkyClouds.mjs` generates them from layered noise and writes
the file, and the same seed gives the same picture. The image is white cloud on
a transparent ground, so the sky's colours can change without redrawing it.

The picture never moves. Panes blur what is behind them, and a backdrop that
animated would have every pane re-blurred on every frame.

## Glass

| Token                        | What it is                                           |
| ---------------------------- | ---------------------------------------------------- |
| `--glass-fill`               | The light pane: a 34% blue tint under a white sheen  |
| `--glass-fill-strong`        | The strong pane: a 70% tint under a fainter sheen    |
| `--glass-fill-control`       | A control or field set into a pane: white at 6%      |
| `--glass-fill-control-hover` | The same, hovered: white at 14%                      |
| `--glass-fill-chip`          | A small label laid on the model: a 74% tint, no blur |
| `--glass-line`               | The edge of a pane: white at 36%                     |
| `--glass-sheen`              | A 1px highlight inside the top edge                  |
| `--glass-blur`               | `blur(22px) saturate(1.15)`, for a pane              |
| `--glass-blur-light`         | `blur(12px)`, for a small control on the map         |

A pane is four declarations together: the fill, the line as a border, the sheen
as a box shadow, and the blur as a backdrop filter.

### Which pane

- **Strong** for anything that can have white behind it: a pane low on the
  screen, where the cloud is, and any pane the model can be panned under. That
  is nearly all of them - the trip sheet, the instruction banner, dialogs, the
  status line, the navigation.
- **Light** only at the very top of the screen with nothing but sky behind it:
  the visitor header, the inspector's toolbar.

The strong pane's tint is not a matter of taste. It is the least that keeps the
soft secondary text at 4.5:1 with pure white behind the pane. Thinner glass
looks airier and measurably stops being readable; `e2e/visitor-contrast.pw.ts`
fails if it is thinned.

### What not to do with it

- **Do not nest a blurred pane inside another.** A control inside a pane is
  `--glass-fill-control` with a border and no blur.
- **Do not make a control's fill much lighter than 6%.** Its edge marks it; a
  lighter fill takes the white text on it below 4.5:1.
- **Do not blur the labels on the model.** There are many and they move with
  the camera; they use the chip fill.
- **Do not put a full-screen overlay inside a pane.** An element with a backdrop
  filter becomes the box its `position: fixed` descendants are laid out in, so
  a dialog nested in a pane fills the pane and not the screen. The QR scanner
  is rendered beside the location picker, not inside it, for this reason.
- **Do not blur inside an immersive AR session.** The compositor there draws a
  blurred pane opaque.

## Colour

| Token                                         | Value                        | Use                                           |
| --------------------------------------------- | ---------------------------- | --------------------------------------------- |
| `--color-whiteout`                            | `#ffffff`                    | Type, icons and edges on glass                |
| `--color-whiteout-soft`                       | white at 92%                 | Secondary text on glass                       |
| `--color-whiteout-faint`                      | white at 80%                 | Placeholders, chevrons                        |
| `--color-hairline`, `--color-hairline-strong` | white at 20% / 40%           | Dividers; control borders                     |
| `--color-ink`                                 | `#0f2147`                    | Type on a white fill                          |
| `--color-sky-tint`                            | `#eef5ff`                    | A link on glass: almost white, and underlined |
| `--color-signal-blue`                         | `#2b7fff`                    | The route and the visitor's own position      |
| `--color-scrim`                               | navy at 30%, with a 3px blur | Fog over the scene behind a dialog            |
| `--surface-whiteout`                          | `#ffffff`                    | The primary button; a pressed toggle          |

Rules:

- Type is white on glass and navy on white. There is no blue text: blue on blue
  glass does not read, so a link is the pale tint with an underline.
- The saturated blue is for things that are drawn - the route, the position
  marker - not for things that are written.
- What green, amber and red used to say by hue is said in words and by the
  weight of an edge: a problem gets a 2px white border, a state that is not
  ready a dashed one. The old accent names still resolve, to white.
- The inspector's model keeps muted hues for what it measures: restricted
  space, edge accessibility, anchors.

## Type

One family, Inter, shipped with the app so it works offline. Interface text is
weight 500, long-form reading 400, and nothing is heavier than 500.

| Token               | Size | Use                          |
| ------------------- | ---- | ---------------------------- |
| `--text-caption`    | 13px | Secondary lines, notes       |
| `--text-control`    | 14px | Buttons, labels              |
| `--text-body`       | 16px | Body, inputs, list rows      |
| `--text-subheading` | 20px | Pane and dialog titles       |
| `--text-heading`    | 32px | The trip time, page headings |
| `--text-heading-lg` | 56px | The welcome headline         |

The scale is in rem, so it follows the text size a visitor has set. 12px is the
floor. Letter spacing is 0 and nothing is upper-cased by CSS.

Caveat (`--font-control-cursive`) sets one word inside an otherwise upright
headline; the welcome screens use it. Anton (`--font-control-compressed`) is
shipped for a rare all-capitals display line and nothing uses it yet.

Small text never sits straight on the sky. Below the top fifth of the screen
the sky is too pale for it. A large headline can; everything else is on a pane.

## Shape and space

| Token              | Value | Use                            |
| ------------------ | ----- | ------------------------------ |
| `--radius-inputs`  | 6px   | Tags, map labels               |
| `--radius-buttons` | 10px  | Buttons, fields, small panes   |
| `--radius-cards`   | 16px  | Panes, dialogs, sheets         |
| `--radius-pills`   | full  | Only a toggle or a filter chip |

Spacing is a 4px grid (`--spacing-4` to `--spacing-120`). A pane stands 8px in
from the edge of a phone screen and 12-16px in on a desk.

## Components

- **Primary button** - solid white, navy text. One per view: the next thing to do.
- **Secondary button** - control fill, white border, white text.
- **Link** - sky tint with a 1.5px underline.
- **Toggle and filter chip** - a pill. Off is the control fill; on is solid white.
- **Field** - control fill, white border, white text; the border goes solid
  white and a 2px ring appears on focus. A native select asks for the system's
  dark list (`color-scheme: dark`).
- **Pane, dialog, sheet** - the strong pane, 16px corners.
- **Tag** - small, 6px corners, outlined.
- **Map label** - a light tag laid on the model; see "Labels on the model" below.

Focus is a 2px solid ring: white on glass, navy on white. In the visitor app
every touch target is at least 44px, and the browser suites check it.

## Layout

- **Phone, journey:** an instruction banner floating at the top of the map, a
  trip sheet floating at the bottom, the model live behind and between them.
- **Desk, journey:** the two stack into one floating side pane; the map takes
  the rest.
- **Idle map:** a header pane above the map, a search pane on it, a status pane
  below.
- **Welcome:** the headline in the open sky, and one pane under it holding
  everything there is to read or press.
- **Operator workbench:** a floating navigation rail on a desk, a floating dock
  on a phone; each region that holds something to read is a pane.

`VisitorMap` measures the panes over the map so its controls and labels stay
clear of them. A pane within 32px of an edge counts as belonging to that edge.

## The models

The visitor's 2D/3D model (`src/map/venueScene.ts`) is drawn on a transparent
canvas, as frosted glass in daylight, and nothing on it has a hard corner.

- **The plate.** The floor is a little larger than the building, with rounded
  corners and an edge turned over in three steps.
- **Rooms are trays.** Each room is a tile of its own, pulled in 17cm from the
  boundary it shares with its neighbours and rounded at the corners, with a
  thin low rim that follows the curve and opens where there is a door. Between
  two trays the plate shows through as a seam of sky. There are no walls on the
  shared boundaries: a wall there has to be square, and it hid the rounding.
- **Corridors have no rim.** They are what you walk along.
- **Translucency.** Walkable space is the most solid, a room is thinner glass,
  restricted space the thinnest.
- **Light.** The sky's blue from every side plus a warm sun. Together they make
  white; where a rim blocks the sun only the blue is left, so shadows fall
  blue, and at a little over half strength so they tint and do not bar.
- **The route.** The only saturated thing on a model. It gives off its own
  blue and takes no light, so it never bleaches in the sun, and it turns its
  corners on a ball. What has been walked turns grey-blue.

The rounding is `src/map/softGeometry.ts`: inset a polygon, round its corners,
cut an outline at its doors, and the footprint of a rim that follows what is
left. A rim is one ribbon from door to door, not a row of pieces: the same
look for about a tenth of the triangles. It is only how the building is drawn.
Routing, clearance and position all work from the authored geometry.

**The model draws only when something changes.** Every eased move has to
arrive: once what is left of it cannot be seen it lands on its target, and the
frame loop goes back to doing nothing. A move that only ever gets closer keeps
the whole scene redrawing, and `venueScene.geometry.test.ts` holds the marker
to that. Eased moves are also a function of time passed and not of frames, so
a slow phone takes as long over one as a fast one.

The inspector's model and the Studio's plan are tools for checking a compiled
venue, so they keep its exact geometry, in the same whites and pale blues
(`src/engine/cartographicTheme.ts`) on clear ground.

### A site with more than one building

A venue may carry a `site`: its buildings, its grounds and what stands on
them (`src/map/siteScenery.ts`). It is a picture and nothing else. What a
visitor can walk on outside - a promenade, a court, a garden path - is a space
like any corridor, and that is what routes use.

- **Outside, a building is a roof.** From far enough out to see the grounds,
  each building is a pale block with a set-back crown, taller for more
  storeys, standing on a plinth, and it is named once. Its rooms and their
  names are not drawn.
- **Inside, the roof is gone.** Coming in closer than about 70 m of ground
  across the view takes the roofs away and brings the rooms and their names
  back. Pressing a building from outside goes in to it. The change is a fade
  between 115 m and 70 m, and nothing is switched.
- **A route is never under a roof.** While a route is showing, roofs are a
  ghost of themselves, so the line can be followed through a building from
  any distance. The route also keeps a least width on screen: its true width
  is a person's, which from across a campus is less than a pixel.
- **Grounds are flat colour under the glass.** Lawn is mint, planting a
  deeper green, water blue and a little raised, paving white, a car park
  slate with its bays marked, a road darker with a dashed centre. Outdoor
  walks are warm white where indoor ones are cool. Trees, lamps, benches, the
  fountain and the statue are a few rounded solids each, drawn as instances.
- **A venue with one building has no site** and is drawn exactly as before.

Which of the two views a visitor is given follows from where they are:

| Where the visitor is               | The map shows                                 |
| ---------------------------------- | --------------------------------------------- |
| Not known yet, or out of doors     | The whole site: the outside view              |
| Inside a building, at a sign       | That building round them, up to 30 m each way |
| On an upper floor                  | That floor, which is one building, round them |
| Looking at a floor that isn't here | That floor, fitted: never an empty screen     |
| A route is showing                 | The route. None of the above moves it         |

Sixty metres across is inside the distance at which the roofs come off, so
coming in to a visitor always arrives among the rooms, on a phone as on a
desk. _Reset the map view_ goes back out to the whole site and _Recenter_
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

### Tapping a place

A place answers a tap on its marker, on its label, anywhere within 26px of its
marker, or anywhere in the room it is in. The marker alone is a pin a few
pixels across; `venueScene.geometry.test.ts` requires every place to answer
over at least 44px each way. With a mouse the pointer changes over anything
that can be pressed.

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

- `prefers-reduced-transparency: reduce`, `prefers-contrast: more` and the
  app's own high-contrast setting all replace the glass with solid navy panes,
  drop the blur, bring soft text to full strength and swap the sky for a plain
  ground.
- Contrast is measured, not declared. `e2e/contrast.ts` hides the text,
  photographs the page and compares each run's colour with the pixels behind
  it; `e2e/visitor-contrast.pw.ts` walks the visitor's screens with it and
  requires WCAG AA everywhere. Reading a background colour from the stylesheet
  says nothing about text on a translucent pane.
