# Meridian Park Medical Campus

A fictional hospital campus, and the first venue that is more than one
building. It exists to prove the part the other venues cannot: a route that
leaves one building, crosses open ground and enters another.

## What is on it

The site is 210 m by 150 m. A visitor arrives at the Main Gate on the south
side and walks north up the Garden Promenade to the Fountain Court, a ring of
four walks round a central fountain. Three buildings stand round the court:

| Building          | Where | Floors | What is in it                                                                                                                                                                                   |
| ----------------- | ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main Hospital     | North | 3      | Registration, pharmacy, imaging, laboratory, cardiology, café and shop on the ground; maternity, children's ward and day surgery on Level 1; wards, dialysis, research and a terrace on Level 2 |
| Emergency Centre  | West  | 1      | Triage, treatment, minor injuries, waiting area, out-of-hours pharmacy                                                                                                                          |
| Wellness Pavilion | East  | 1      | Hydrotherapy pool, rehabilitation gym, studio, therapy rooms                                                                                                                                    |

Between them are lawns with trees, a Healing Garden with the Founders' Statue,
a pond, and the Visitor Car Park beside the promenade.

## How it is modelled

**What you can walk on is a space.** The promenade, the court, the garden walks,
the car park and the Healing Garden are spaces with doorways between them,
exactly like corridors and rooms. That is all the router needs: a route from
Triage to the Hospital Pharmacy goes out through the Emergency Entrance, along
the West Garden Walk, round the fountain, up the Hospital Forecourt and in.

**What you only look at is the site.** The `site` block lists the three
buildings (footprint and number of storeys), the grounds (lawn, planting,
water, paving, parking, road) and the features (trees, the fountain, the
statue, benches, lamps). Nothing in it is routed over, measured against or
located by. It is a picture of the place, and a venue that is one building has
no `site` at all.

The ground floor's outline is the whole site. The upper floors' outline is the
Main Hospital's footprint, because that is the only building with any.

The Fountain Court is four walks rather than one square so that routes go
round the water. A single space is crossed through its middle, and the
fountain is in the middle.

## Making it

`source/building.json` is what the compiler reads. It is written by
`source/author.mjs`, which describes the campus as rectangles on a metre grid
and works out the rest: each doorway is placed at the middle of the wall two
spaces actually share, and it stops with an error if they do not share one.

```bash
node buildings/meridian-park-campus/source/author.mjs
npm run compile:campus
npm run venues:sync
node scripts/refreshCatalogRelease.mjs meridian-park-campus
npm run codes
```

The catalog entry in `public/venues/catalog.json` names a release by its
package's content hash, so it goes stale whenever the package changes. The
third step points it at the package just published.

## How it is drawn

From outside, the three buildings are roofs with their names on them, among
the lawns, the pond and the car park. Coming in close, or pressing a building,
takes the roofs off and shows the rooms. While a route is showing the roofs
are a ghost, so the line can be followed from one building, across the
grounds and into another.

Where the map opens depends on where the visitor is. With no check-in, or one
at an outdoor sign such as the Main Gate, it opens on the whole site. A
check-in at an indoor sign opens it among the rooms round that sign, with the
whole site one press away on _Reset the map view_.

`docs/design-system.md` has the rules; the drawing is
`src/map/siteScenery.ts`.

## Checking its directions

A place is reached through the middle of its space. One pinned somewhere else
in a large space - the car park by its way out, an entrance just inside its
door - sends every route in to the middle and back, with a "turn around" in
the written steps. So places sit in the middle of their spaces unless there is
a reason, and every trip is read before a change is kept:

```bash
npm run directions:audit -- meridian-park-campus
npm run route -- meridian-park-campus poi-l2-dialysis poi-w-gym
```

The first reads all 4,300 trips - from each public place and each of the eight
signs to each public place, fastest and step-free - and lists any with no
route, a route that cannot be drawn on the map, a turn back, or the same
sentence twice. The second prints one trip as a visitor is told it.

A sign starts its routes in the space it hangs in: at the nearest point along
a corridor, or the middle of a room. So a sign goes where the visitor who
scans it stands. The car park's is on the walk by its way out, not in the car
park, whose middle is forty metres back.

## Opening it

The catalog's default venue is unchanged. This one opens by link:

```
/?venue=/venues/meridian-park-campus.package.json#/visitor
```

Its eight check-in signs are on the printable sheet at `/check-in-codes.html`.
