# Visitor live tracking

Updated 25 September 2026. `src/navigation/liveTracker.ts` and
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
calibration. Each movement is judged against the corridor exactly as a stride
is, with its length in stride-equivalents added to the off-route and
wrong-way tallies, and uncertainty grows at 3% of the distance moved instead
of 8%. The session's world is lined up with the plan once, from the same
assumption the tracker makes at a scan - the visitor is at their progress,
looking the way the route goes - and `src/ar/planWorld.ts` holds nothing but
that one rotation and offset. A storey change starts the alignment again on
the new floor. Frozen holds: once twelve stride-equivalents have disagreed, or
uncertainty has passed twelve metres, nothing moves the marker until a scan
gives it a new anchor.

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
physical position. AR startup uses that physical position and its route
bearing; it refuses to create an anchor from a preview. No-heading strides
increase uncertainty without moving the marker, including the first stride
before the missing-gyroscope diagnosis settles. XR displacement carries its
own direction and does not require the stride integrator's heading.

## The camera view's own sensors

The camera view subscribes to the phone's orientation itself rather than
reading the tracker's, because the two want different things. The tracker
wants turn rates while a walk is being followed, and only once the visitor
has asked for that. The camera wants to know where the phone is pointing from
the moment it opens, tracked or not, because a route drawn at a guessed
heading and a guessed tilt sits in a fixed place on the glass. Neither feed
is a position, and neither is evidence.

Where the tracker has learned a direction of travel, the camera prefers it:
it is the same gyroscope, already tied to the route by a walk. Otherwise the
camera's own yaw carries the turn and its zero is fixed by the visitor, or
assumed from the route and labelled as an assumption.

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
