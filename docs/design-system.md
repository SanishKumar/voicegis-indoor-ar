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
- **Map label** - the chip fill with white text; the destination's label is
  solid white with navy text.

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
canvas. Floor plates are translucent - walkable space the most solid, a room
thinner glass, restricted space the thinnest - so the sky shows through them.
Walls are white. The light is the sky's blue from every side plus a warm sun;
together they make white, and where a wall blocks the sun only the blue is
left, so shadows fall blue. The route is the only saturated thing on a model,
and what has been walked turns grey-blue.

The inspector's model and the Studio's plan use the same idea in opaque whites
and pale blues (`src/engine/cartographicTheme.ts`), on clear ground.

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
