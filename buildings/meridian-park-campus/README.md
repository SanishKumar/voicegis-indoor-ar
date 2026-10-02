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
npm run codes
```

The catalog entry in `public/venues/catalog.json` carries the package's content
hash and has to be updated when the package changes.

## Opening it

The catalog's default venue is unchanged. This one opens by link:

```
/?venue=/venues/meridian-park-campus.package.json#/visitor
```

Its eight check-in signs are on the printable sheet at `/check-in-codes.html`.
