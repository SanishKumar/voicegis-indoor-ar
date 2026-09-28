# Visitor live tracking

Updated 28 September 2026. `src/navigation/liveTracker.ts` and
`src/components/journey/useLiveTracking.js` move the visitor's guidance from
the phone's own motion sensors. This is **guidance, not evidence**: it exists so
that a person following a route does not have to press anything, and it is
kept apart from the recording, replay and evidence pipeline, whose stricter
contracts remain exactly as documented in the other files in this directory.

## What it claims, and on what assumption

The tracker answers one question - how far along the route is the visitor, and
how sure are we - under one stated assumption: **after a check-in, the visitor
sets off along the route they asked for.** Everything else follows from
testing that assumption against what the sensors report:

- A stride is a footfall detected by the existing `DeadReckoningIntegrator`
  (peak over the gravity baseline, falling edge, refractory period).
- Direction of travel is the gyroscope's turn, integrated relative to the
  moment of departure and tilt-corrected through `headingRateDegreesPerSecond`.
  It is never an absolute compass heading. The first few strides after an
  anchor establish the alignment between that relative turn and the route's
  bearing at that point - which is why a person who scanned a sign facing the
  wall and then turned to walk is not counted as off-route.
- A stride advances progress along the route only while that direction agrees
  with the corridor (within 60°, or any bearing within 3 m of a corner). A
  stride back the way the visitor came walks the marker back. Anything else is
  disagreement, and disagreement accumulates into caution, then a freeze.
- Uncertainty starts at the anchor's (1 m for a scan, 4 m for a chosen
  landmark) and grows by 8% of the distance walked; it resets at every scan.
  Between two scans, the route distance divided by the strides counted
  calibrates the stride length for the rest of the walk.
- **A storey change is never inferred.** At a lift or stair the tracker stops
  at the boarding point and waits for a scan on the new floor or for the
  visitor to say they have arrived there. Only then does progress continue,
  with extra uncertainty for the ride.

Where the platform offers a compass (`webkitCompassHeading`, or absolute
orientation), it is consulted for one purpose only: to notice, in the first
strides, that the visitor is setting off away from the route. The venue's
declared `northOffsetDegrees` is applied as stated for that 180° test and for
nothing finer, because it is not surveyed.

## A pose instead of strides

Inside an immersive WebXR session (`src/ar/arSession.ts`) the phone measures
its own movement through the room, in metres, with its camera and inertial
sensors. The tracker takes that movement through `attachDisplacement` and
`displace` and stops moving progress for strides while it does, so the same
walk is never counted twice; strides still count towards the stride
calibration. Uncertainty grows at 3% of the distance moved instead of 8%.
The world-to-plan transform uses the tracker's physical position and the
available building heading (including the explicitly approximate sign heading
or manual alignment), never the route's bearing as a substitute for a missing
heading. `src/ar/planWorld.ts` holds that rotation and offset. Floor height
requires a detected surface confirmed by the visitor. A storey change starts
placement again on the new floor.

`src/navigation/routePoseMatcher.ts` now matches the **unsnapped cumulative
plan-frame position**, not just the angle and length of the latest movement:

- Sideways distance adds to distance walked and uncertainty, not forward progress.
- A missed turn holds at the corner; it cannot spend straight-line travel on
  the next leg. Normal turns and backward travel still move the marker.
- Candidates are confined to the current contiguous floor run and a progress
  window of the latest movement length plus 3 m (twice the lateral guard, to
  allow projections to change legs when rounding a corner). Distant crossings
  and parallel return legs outside that window are excluded; a later visit
  to the same storey cannot bypass the intervening floor changes.
- A point further from all eligible route legs than the sideways allowance
  (below), an unreachable projection, or similarly good non-adjacent
  candidates freezes guidance as `off-route`.
  Ambiguity means distances within 0.2 m and progress positions over 0.5 m apart.
- The retained point is **never replaced with its projection** between reports.
  Otherwise each update would erase a small sideways departure and a parallel
  walk could appear to follow the route indefinitely.
- This loss is latched. Stop/resume, switching to strides, leaving/re-entering
  AR, re-aligning the camera or re-confirming a floor cannot clear it. A new
  check-in/known-position anchor is required. AR hides the route and prioritizes
  the scan instruction over camera/floor recovery prompts.

These are provisional matching guards, not corridor boundaries or a safety
clearance. A nearby matched point does not prove that the space between it and
the route is walkable. An inaccurate initial position can also cause a hold.

### Venue alternatives before correction

The visitor now passes the active venue's complete routing graph to
`venuePoseGuard.ts`. After a successful route-only pose match, **before progress
or heading learning changes**, this additional check looks for another planar
path on the same floor that fits the measured position at least as well (within
0.2 m). Its projection must be more than 0.5 m from the selected route; shared
junctions, overlapping edges and subdivisions must not invent another location.

An alternative must be reachable through the graph from this placement's origin
within measured walking distance plus the fixed 3 m rounding allowance. Keeping
that origin, rather than starting every check at the latest route projection,
preserves shallow fork hypotheses while the branches separate. Disconnected
nearby corridors, distant connecting detours and paths requiring a storey change
do not compete. Geometric distances are used, including zero-length portal links.
Restricted/inaccessible paths still count as physical location hypotheses; this
does **not** authorize routing through them. Closure lists are not used to erase
possible locations either.

A competing path latches `ambiguous-position`: freeze progress, hide the AR route,
explain that more than one venue path fits, and ask for a check-in scan. Re-align,
sensor switching and waiting cannot clear it. No candidate becomes a new position
or an automatic reroute. Mismatched graph/route geometry holds as `uncertain`
with `poseGraph: unavailable`. The optional field log includes `poseGraph`:
`not-checked`, `clear`, `ambiguous`, or `unavailable`. Stride-only guidance has
no independently measured XY position and does not run this check.

This is a conservative veto, **not** multi-hypothesis localization. It uses the
same approximate plan-frame pose and provisional distance thresholds as the route
matcher. A `clear` result does not prove the corridor, heading, walkable clearance
or survey accuracy. Alternatives too close to separate, absent from the graph,
or obscured by incorrect initial pose/heading may still be missed. Some legitimate
walks near branches may pause. Real-venue and handset trials are still needed.

### Direction learned from walking

Direction learning takes an initial estimate per placement and then locks it
against change of any size: only later stretches that agree with it within 10°
refine it, so a genuine departure is never learned. A zero-degree estimate locks
too. Resetting placement starts learning again, but cannot clear an
already-latched off-route loss.

`routePlanarLegs.ts` gives the matcher and corrector the same straight geometry:
connected collinear edges are one leg, regardless of map-node density. Actual
bends, reversals and floor changes remain separate. Dividing a straight corridor
into quarter-metre or two-metre edges must not prevent calibration or create
false ambiguity between pieces of that same straight leg.

The first straight walk is **assumed to follow the selected route**. These
observations alone cannot distinguish an initial diagonal departure from a
placement heading error. Rotating the displacement history changes the estimated
position as well as the direction; not snapping directly to the route does not
make that an independent position observation. No surveyed accuracy is implied.

A session is placed with an approximate direction - a scanned sign, or the
visitor's own alignment - and every step is turned by the same error. Walking
straight down a corridor then drifts sideways by about the error's sine per
metre: a strict 1.5 m guard froze guidance after 17 m at 5°, 9 m at 10° and
4.5 m at 20°. `src/navigation/poseHeadingCorrection.ts` learns that error:

- Over a stretch of 3 m along one leg, at least 1 m from either end, with the
  path at least 90% straight, the angle between the path and the leg (either
  way along it) is taken as the initial direction error, at most 30 degrees.
  The estimate then locks. Crooked paths, stretches whose halves point more than
  8° apart (a turn inside the stretch) and stretches near corners teach nothing.
- A single 3 m stretch is a short baseline: a 0.6 m lane change in the first
  metres locked a 7.6° error and stopped a straight walk at 16 m; 10 cm of phone
  sway locked a 2.4° error and stopped it at 35 m. So a later stretch on the same
  leg that agrees with the estimate within 10° joins a baseline, and the estimate
  is taken again over the whole baseline. A stretch counts only once the next
  one also agrees: the first stretch into a departure can still look like the
  corridor, and the one after it shows it was not. A stretch that disagrees
  drops the one before it. A departure of 15° or more is therefore not learned.
- Every step since this placement's direction was set was walked with the
  same error, so all of them are recomputed with the correction. The position
  is not dropped onto the route line; it moves only as the corrected steps put it.
- Until a stretch supplies the initial estimate, the sideways allowance grows
  from 1.5 m by tan(20 degrees) per metre of **progress along the route**, capped
  at 4 m. Once locked it grows only by tan(4 degrees) per metre of progress,
  capped at 2.5 m, and each agreeing stretch renews it. Sideways-only walking,
  or walking on past a missed corner, makes no progress, so it gets no more room.
- The facing reported for turn cues gets the same correction, and the AR
  session redraws the route with it, so the arrows straighten with the marker.
- A new placement (re-alignment, anchor, storey change) forgets the correction.

Simulated walks: straight 30 m placed 5-30° off keeps guiding and learns the
error to within a tenth of a degree; an L-shaped route placed 15-20° off keeps
guiding through the turn; 55 m placed 15° off keeps guiding with a 0.3-0.9 m
lane change in the first metres or 5-10 cm of phone sway. A 15° departure after
16 m stops 8 m later with the estimate unchanged. Walking 45° off the corridor
still stops after 3 m, straight past a corner 2 m past it, and sideways off the
route at 1.8 m. 20 cm of side-to-side sway defeats the straightness test and
stops a long walk: the estimate then never forms.
The thresholds are provisional software guards, not surveyed corridor widths;
an open hall walked diagonally for 3 m could be mistaken for direction error.
Handset runs record the initial estimate and its learning/locked state in the
field log (`ar-heading-correction`), including a locked zero-degree estimate.
The log marks its basis as `initial-corridor-assumption`.
The IMU-only stride estimator retains its existing direction/tally model; it
does not gain independent XY localization from this change.

Pose continuity is checked in two places. The session rejects a change over
0.5 m when it implies more than 4 m/s or follows a frame gap over one second.
The tracker independently rejects a displacement over 1.5 m, speed over
5 m/s, or non-increasing movement timestamps, including the first movement
after alignment. Either rejection hides the route and requests explicit
re-alignment; the rejected movement is not replayed after recovery. These
are experimental software thresholds, not device-qualified accuracy limits.

## The four tiers

| Tier     | Meaning                                                                                                                            | What the interface does                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| anchored | At a known point, no strides yet                                                                                                   | "Anchored"; says to set off along the route                                                     |
| tracking | Strides agree with the corridor; σ under 6 m                                                                                       | Marker moves; banner counts down; map follows heading-up                                        |
| caution  | σ over 6 m, a run of disagreeing strides, or walking back the way you came                                                         | Marker still moves; label says why; a scan is offered                                           |
| frozen   | No anchor or stride heading, sensors silent or missing, a pose jump, twelve disagreeing strides, σ over 12 m, or waiting at a lift | Marker holds; label says what would help; re-alignment, a scan or floor confirmation is offered |

In addition to the freezes above, incompatible or ambiguous pose geometry
freezes with `off-route` and requires a new position anchor.

The pill in the instruction banner carries the tier by weight - solid,
heavier rule, broken rule - not by hue, in keeping with the rest of the
surface. The map draws the one-sigma uncertainty as a ring in metres under
the marker; the walk-through, which measures nothing, draws none.

## Lifecycle

Tracking starts from a tap, because iOS grants motion access only inside a
gesture. The existing consent-owned `startHandsetSubscription` handles secure
context, permission requests, revocation and background pauses; a hidden page
stops tracking and offers to resume. Stopping and resuming the same route
keeps progress and uncertainty and re-learns the direction of travel. A new
route from a scan re-anchors at that route's start and keeps the calibrated
stride. Arrival is reported from 2.5 m out (`ARRIVAL_METERS`, which the
journey reducer shares); a visitor who confirms it from within that radius is
believed, the marker lands at the door and tracking ends. Nothing here
persists across a reload.

The visitor shell owns the choice between tracking and a walk-through:
starting tracking pauses the preview, and starting a walk-through or selecting
an instruction to inspect stops tracking. A preview changes the guidance on screen, never the tracker's
physical position. AR startup uses that physical position and an available
building heading; it refuses to create an anchor from a preview. No-heading strides
increase uncertainty without moving the marker, including the first stride
before the missing-gyroscope diagnosis settles. XR displacement carries its
own direction and does not require the stride integrator's heading.

## The camera view's orientation

The camera view uses the shared visitor orientation feed rather than relying
only on the stride tracker, because the two want different things. The tracker
wants turn rates while a walk is being followed, and only once the visitor
has asked for that. The camera wants to know where the phone is pointing from
the moment it opens, tracked or not, because a route drawn at a guessed
heading and a guessed tilt sits in a fixed place on the glass. Neither feed
is a position, and neither is evidence.

Where the tracker has learned a direction of travel, the camera prefers it:
it is the same gyroscope, already tied to the route by a walk. Otherwise the
camera's yaw carries the turn from manual alignment or the approximate direction
established when scanning a sign. Missing direction is reported, not silently
replaced with the route's bearing. Orientation continuity is maintained by
the shared visitor orientation feed across scanning and camera view.

## What it is not

It is not an accuracy claim. The 8% drift figure, the 60° agreement band, the
3 m corner window and the six/twelve stride thresholds are conservative
software policy chosen so that Asterion's 48 m sign spacing keeps a
scan-to-scan walk in the tracking tier. None of it has been measured on a
physical handset in a real building, and the synthetic browser journeys in
`e2e/live-tracking.pw.ts` prove the software's behaviour, not a phone's
sensors. The recorder and the evidence artifact remain the only path to a
figure that may be quoted.

It also cannot see the building. A visitor who leaves the route is told so
and offered a scan; the route is not re-planned from a guessed position,
because the tracker has no trustworthy position off the route to plan from.

## Regression coverage for pose matching

`routePoseMatcher.test.ts` covers rotation/translation invariance, normal and
missed corners, retreat, crossings, parallel legs, ambiguous hairpins, repeated
vertices, floor boundaries and invalid input. `liveTrackerDisplacement.test.ts`
checks the full stream, including loss that survives source changes and clears
only on an anchor. `arSession.test.ts` drives rendered frames through lateral
departure and recovery; `arPrompt.test.ts` ensures the scan action stays visible.
These are synthetic software checks, not a claim of real-handset accuracy.
