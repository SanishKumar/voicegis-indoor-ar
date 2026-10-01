# Testing the guidance on a phone

What happens on a phone cannot be seen from the desk. This page is how to test
the visitor guidance on a handset and bring back a record of what it did.

## 1. Open the app on the phone

Either, with the phone and the computer on the same Wi-Fi:

```bash
npm run dev:mobile
```

and open the printed **Network** address on the phone (`https://<computer's
address>:3000`), accepting the certificate warning once. Or, once the project
site has been published (see [deployment](deployment.md#publishing-to-github-pages)),
open `https://<owner>.github.io/<repository>/`.

Both are HTTPS. The camera, the motion sensors and WebXR all require it.

## 2. Turn on the test log

Add `?fieldtest=1` before the `#`:

```text
https://<address>/?fieldtest=1#/visitor
```

A small **Test log** button appears at the left edge of the map and the camera
view. It stays on for that browser tab; `?fieldtest=0` turns it off.

The log records, with the seconds since it started:

- what the phone offers: immersive AR, orientation and motion events and
  whether they ask permission, camera, speech voices, the offline worker;
- the build and the venue it is running;
- each change of tracking state and position tier, and the position every five
  metres;
- the camera view's orientation state and where its facing comes from;
- each AR step: start, running, how placing the route went (no pose yet, not
  held still, looking for the floor, placed — with the floor hits and height
  found), lost tracking, the prompt shown, and each button pressed;
- camera errors.

It is kept in memory on the phone only, is lost when the tab closes, and is
never sent anywhere. **Copy report** puts it on the clipboard to paste into a
message; where the clipboard is unavailable the text can be selected by hand.
It is a diagnostic of the guidance, not evidence, and nothing reads it back.

## 3. What to try

### Short re-test after the V29e report (29 September 2026)

The reported `ce0eebe` walk detected 61 strides; it did not have a dead motion
sensor. It rejected sign direction (`no-orientation`), reached an estimated
18.72 m, then retreated and froze at high uncertainty. Those entries do not
establish the visitor's actual path. No `ar event=start/running` occurred, so
that report tested the estimated camera overlay, not WebXR floor placement.

Do these as **separate attempts**, returning physically to the displayed sign
and scanning again before each. Clearing the log does not reset location.
Walking back without a fresh scan is not a new check-in. Do not follow the
sample hospital route through a different building's walls or obstacles.

1. **Scan and direction only:** face the `g/east` sign squarely and scan. If
   the scanner says direction is waiting, gently turn the phone and face the
   sign again; allow the direction sensor if prompted. The check-in now says
   explicitly if only location was captured. Open Camera view **without
   starting Track my walk**, and check for “Direction from the sign · approximate”.
   With Civic Plaza Entrance selected, the route should initially be behind
   you. Turn around and copy the log. A quiet complete gyroscope stream now
   corroborates an unchanged orientation; missing or turning samples cannot.
   A brief delivery gap hides the route until a fresh reading arrives on the
   same reference; it no longer silently erases the sign calibration. Putting
   the page in the background or losing the sensor reference still invalidates it.
2. **AR before any walking:** return to the sign and scan again. Open Camera
   view → Start AR → confirm a blue floor ring. Only this mode detects a
   floor. The ordinary camera view explicitly labels its floor height as an
   estimate. Copy the report even if placement fails; it must include an AR
   start/running/failure entry. Stop here if direction or floor is missing.
3. **Map walk separately:** return to the sign and scan again; Track my walk,
   turn away from the sign, walk 5–10 m with the phone held facing your walking
   direction, pause, then turn back and walk a few metres. Copy the log. With
   a captured sign direction, the map now uses it too; it does not infer a new
   forward direction from the route after a signal dropout. Without a captured
   sign, the older route-departure assumption is still a limitation.

If location freezes, stopping tracking must **not** make the route trustworthy
again: both the map and camera retain the need for a fresh check-in. The log
now includes orientation diagnostics from before the scan and motion/heading
availability, not only events recorded after opening the camera. These fixes
have synthetic coverage, not a completed handset validation.

A route and a start point first: pick a destination, then scan a check-in code
(`/check-in-codes.html` on the computer's screen) or pick a landmark.

- **AR with no direction alignment.** Camera view → **Start AR**, then aim at
  clear floor nearby. A ring marks an observed
  surface: white while settling, blue when stable. Check that it is on the
  floor, not furniture, then tap **This is the floor**. The route must not
  appear before that confirmation. If surface detection is unavailable, leave
  AR and use the map; waiting must never place it on a guessed floor. With no
  direction alignment, confirmation must say **does not know which way you are facing**,
  keep the route hidden and leave **Leave AR** reachable. Floor height is not yaw.
- **Manual direction fallback.** Before Start AR, check the map, face along the
  route at your actual check-in point, and tap **I'm facing the corridor**.
  Keep fresh orientation available, then start AR and confirm the floor. If
  direction is unavailable, raise the camera slightly; otherwise leave AR.
  Turning around before confirmation must not redefine the route as straight ahead.
  A scanned sign sets an approximate direction without this step (below).
- **Walking.** Walk the route's direction; the distance left should count down
  and the chevrons stay on the floor. If the arrows start at an angle to the
  corridor, use a known clear stretch, not the misplaced arrows, to choose
  where to walk. The first straight stretch supplies the initial direction
  estimate (`state: settling`). Two consecutive agreeing stretches may refine
  it once; then `state: locked` means no further learning until a new placement.
  A turn, disagreement or 12 m of settling progress closes that opportunity too.
  The Test log records `ar-heading-correction`, even without an angular change.
  Locked still means an assumed corridor
  direction, not surveyed heading accuracy. Later departures must not make the
  app keep rotating its idea of the corridor to follow you. The first diagonal
  walk is still ambiguous; this heuristic is not obstacle detection or a way
  to discover which corridor you are in.
  Simulations now cover 10–20 cm of hand sway at several sampling rates/phases;
  that is not proof of phone accuracy. The route matcher still sees the full
  measured motion, so this does not smooth away a real sideways departure.
- **Competing venue paths.** When another reachable path fits the measured
  movement as well as the selected route, the route must disappear and say
  "More than one venue path fits your movement". Leave AR and scan a check-in
  code. Re-aligning or switching views must not resume a guessed position.
  The `position` log records `reason: ambiguous-position` and
  `poseGraph: ambiguous`; `clear` means no competing candidate passed the
  software gates, not a verified location. This needs a matching venue to judge
  physically, and is not automatic rerouting or obstacle avoidance.
- **Lost tracking.** Cover the camera for a few seconds: the view should say it
  lost track of the room and offer Re-align. Find and confirm the floor again;
  an old floor confirmation must not survive loss of the reference frame.
- **Floor stability.** After placement, point at a table. The route must stay
  at the confirmed floor height rather than moving onto the tabletop. This
  is not obstacle detection or occlusion: neither is implemented.
- **Without motion access.** Refuse motion access and start AR again: the session
  must still open. Pose walking requires a confirmed floor and direction. If
  orientation is also unavailable, no direction must be invented to enable it.
- **Direction from a sign.** Scan a check-in code while facing it squarely
  (the laptop screen stands in for the sign), then open the camera view. It
  should say "Direction from the sign · approximate" and, if the route leaves
  behind the sign, "The route is behind you. Turn around". Turn around: the
  route should appear ahead. Then Start AR and confirm the floor; the route
  should be placed without "I'm facing the corridor". If AR stays on
  "does not know which way you are facing", copy the Test log.
- **Flat camera view** (phones without AR): tap **I'm facing the corridor**
  while facing along the route, then turn — the route should turn with the phone.

After each try, open **Test log → Copy report** and send the text along with
what you saw. Placement requires half a second held still within 15 cm and
12°. Surface qualification requires at least six observations over half a
second, no gaps over 250 ms, height variation within 3 cm of the initial hit,
and a target within 15 cm of its initial horizontal position. The reported
normal must point up within 10°, with the surface 0.25–2.5 m below the camera
and within 4 m of it. These are provisional gates, not measured accuracy.
The log records floor-search/confirmation/unavailable states and whether a
confirmation tap was accepted. `floorY` remains null until confirmed.

This currently assumes a level floor. It does not fit ramps, classify floors
automatically, or establish the building's direction. Manual route-facing
alignment is a declaration, not a measurement. Testing a sample venue in a different corridor
can exercise placement and relative motion, not navigation to real destinations.
