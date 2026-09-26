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

A route and a start point first: pick a destination, then scan a check-in code
(`/check-in-codes.html` on the computer's screen) or pick a landmark.

- **AR with no direction alignment.** Camera view → **Start AR**, then aim at
  clear floor nearby. A ring marks an observed
  surface: amber while settling, green when stable. Check that it is on the
  floor, not furniture, then tap **This is the floor**. The route must not
  appear before that confirmation. If surface detection is unavailable, leave
  AR and use the map; waiting must never place it on a guessed floor. With no
  direction alignment, confirmation must say **building direction is not aligned**,
  keep the route hidden and leave **Leave AR** reachable. Floor height is not yaw.
- **Manual direction fallback.** Before Start AR, check the map, face along the
  route at your actual check-in point, and tap **I'm facing the corridor**.
  Keep fresh orientation available, then start AR and confirm the floor. If
  direction is unavailable, raise the camera slightly; otherwise leave AR.
  Turning around before confirmation must not redefine the route as straight ahead.
  Automatic sign-derived heading is not implemented yet.
- **Walking.** Walk the route's direction; the distance left should count down
  and the chevrons stay on the floor.
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
