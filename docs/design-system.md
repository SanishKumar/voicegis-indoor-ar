# Design system

How the app looks, and the rules a new screen has to follow. The tokens live at
the top of `src/index.css`; the fonts are declared in `src/styles/fonts.css`.

## The idea

A black canvas with light islands on it. Chrome that sits on the canvas is drawn
in white with thin borders and no fill. Anything a visitor types into or reads
as a self-contained card is a light surface with dark text. One colour, a blue,
is reserved for the route and for links. Nothing casts a shadow, nothing is
glass, and nothing is a gradient: depth comes from contrast alone.

The app is dark only. There is no light theme to keep in step.

## Colour

| Token                                         | Value              | Use                                                                                                        |
| --------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `--surface-dark-canvas`                       | `#000000`          | The page, the map stage, sheets and banners                                                                |
| `--color-whiteout`                            | `#ffffff`          | Text and icons on the canvas                                                                               |
| `--color-whiteout-soft`                       | white at 68%       | Secondary text on the canvas                                                                               |
| `--color-hairline`, `--color-hairline-strong` | white at 20% / 42% | Dividers and control borders                                                                               |
| `--surface-haze-card`                         | `#f5f5f5`          | Cards, inputs, the primary button, a pressed toggle                                                        |
| `--color-ink`                                 | `#1b1b1b`          | Text on a light surface                                                                                    |
| `--color-ink-soft`                            | ink at 66%         | Secondary text on a light surface                                                                          |
| `--color-signal-blue`                         | `#2b7fff`          | The route, links, small tags                                                                               |
| `--color-twilight-blue`                       | `#426188`          | The ways between floors on the models. Available for a large heading set in colour; too dim for small text |
| `--color-scrim`                               | black at 72%       | Behind a dialog, and under controls laid over the map or camera                                            |

Rules:

- Blue is never a button fill. A button is either an outline on the canvas or a
  light fill.
- One saturated colour per screen. What green, amber and red used to say by hue
  is said in words and by the weight of a rule: a problem gets a 2px border, a
  state that is not ready gets a dashed one. The old accent names still resolve,
  to white.
- The 3D inspector is the one place with more than one hue, and only for what it
  measures - restricted space, edge accessibility, anchors. Those are muted.

## Type

One family, Inter, shipped with the app so it works offline. UI text is weight
500; long-form reading is 400. Nothing is set heavier than 500.

| Token               | Size | Use                          |
| ------------------- | ---- | ---------------------------- |
| `--text-caption`    | 13px | Secondary lines, notes       |
| `--text-control`    | 14px | Buttons, labels              |
| `--text-body`       | 16px | Body, inputs, list rows      |
| `--text-subheading` | 20px | Card and dialog titles       |
| `--text-heading`    | 32px | The trip time, page headings |
| `--text-heading-lg` | 56px | The welcome headline         |

The scale is in rem, so it follows the text size a visitor has set. 12px is the
floor; nothing is set smaller. Letter spacing is 0 and nothing is upper-cased by
CSS.

Two display faces are available and used sparingly: Anton
(`--font-control-compressed`) for a rare all-capitals display line, and Caveat
(`--font-control-cursive`) for a single word inside an otherwise upright
headline. The welcome screen uses the second; nothing uses the first yet.

## Shape and space

| Token              | Value | Use                            |
| ------------------ | ----- | ------------------------------ |
| `--radius-inputs`  | 4px   | Inputs, tags, map labels       |
| `--radius-buttons` | 8px   | Buttons, small panels          |
| `--radius-cards`   | 12px  | Cards, dialogs, sheets         |
| `--radius-pills`   | full  | Only a toggle or a filter chip |

Spacing is a 4px grid (`--spacing-4` to `--spacing-120`). Cards are padded 20px
(`--card-padding`). For a new page-style screen the tokens `--element-gap` (8px),
`--section-gap` (48px) and `--page-max-width` (1150px) are defined; the current
screens are full-bleed maps and sheets and do not use the last two yet.

## Components

- **Primary button** - light fill, dark text, 8px corners. One per view: the next
  thing to do.
- **Ghost button** - transparent, 1px white border. Everything else.
- **Link** - blue with a 2px underline.
- **Toggle and filter chip** - a pill. Off is an outline or a faint fill; on is
  the light fill.
- **Input** - white or haze, dark text, 4px corners, a single focus ring.
- **Card and dialog** - a light island: haze, no border, 12px corners, over a
  scrim.
- **Tag** - small, 4px corners, outlined.
- **Controls over the map or camera** - ghost buttons on a scrim so they stay
  readable over whatever is behind them.

Focus is a 2px solid ring: white on the canvas, dark on a light surface. In the
visitor app every touch target is at least 44px, and the browser suites check it.

## Light islands in the stylesheet

The visitor layer was written against three names - a surface (`--ed-cream`), a
text colour (`--ed-ink`) and an accent (`--ed-blue`) - which now mean the canvas,
white and blue. A container that should be a light island restates those three
for itself and is listed alongside `.visitor-shell` in the rule that maps the
older token names, so everything inside it is worked out again from the island's
palette. The search panel, the location picker, the destination card and the
check-in message are built this way.

The camera view was written the other way round, dark first, so it restates the
names in the opposite sense.

## The models

The visitor's 2D/3D model, the Studio floor plan and the inspector share one
set of plate colours: walkable space is the lightest, rooms darker, restricted
space darkest, walls drawn light so the plan reads. The route is the only
saturated thing on a model, and what has already been walked turns grey.
