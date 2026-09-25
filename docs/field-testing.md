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

- **AR start.** Camera view → **Start AR**. Hold the phone up, facing the way
  the route goes, then point it at the floor a few steps ahead. The route
  should appear on its own within a few seconds, without tapping Re-align.
- **Walking.** Walk the route's direction; the distance left should count down
  and the chevrons stay on the floor.
- **Lost tracking.** Cover the camera for a few seconds: the view should say it
  lost track of the room and offer Re-align, which brings the route back.
- **Without motion access.** Refuse motion access when asked (or in the
  browser's site settings) and start AR again: it should still start and count
  down.
- **Flat camera view** (phones without AR): tap **I'm facing the corridor**
  while facing along the route, then turn — the route should turn with the phone.

After each try, open **Test log → Copy report** and send the text along with
what you saw. The thresholds the AR placement uses (half a second held still
within 15 cm and 12°, four seconds to find the floor) are first estimates; the
log is what they will be tuned from.
