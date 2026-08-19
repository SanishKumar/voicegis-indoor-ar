# The 60-second demo

What this shows: **a stranger walks into a building, scans one code, and gets a
step-free route to any room — with no beacons installed, no site survey, and no
network.**

Everything the app needs is inside a compiled venue package that was produced
from CAD and sealed with a content hash. There is no positioning service behind
this and nothing to call home to.

## Run it

```bash
npm run dev
```

Open the printed codes on this machine, in a second tab or window:

```text
http://localhost:3000/check-in-codes.html
```

Then in the app: **Plan a route → Scan a check-in code**, and point the camera at
one of the codes on screen. On a laptop with no camera, pick a landmark from the
list instead — the rest of the flow is identical.

To do it properly from a phone, with the codes on your laptop screen:

```bash
npm run dev:mobile
```

That serves HTTPS on the LAN and prints a Network URL. The camera and the motion
sensors both require a secure context, so plain `http://192.168.x.x` will fail —
see [Recording a walk on a phone](localization/recording-on-a-phone.md).

## If the camera is not cooperating

A check-in can also be carried in the URL, using the same payload a sticker
encodes:

```text
http://localhost:3000/?checkin=voicegis://asterion/l2/east#/visitor
```

The app opens already checked in, on the right floor, and the parameter is
stripped so a refresh does not silently send you back. This is the same
resolution path the scanner uses, so it is a fair demo and not a mock — and it
means a flaky camera cannot take the demo down.

## The four beats

1. **Scan.** A code at a corridor junction resolves to a surveyed anchor: floor,
   position, heading. The app now knows where you are, to about a metre, and
   says so — *Checked in at Family Care Concourse · Level 2 · anchor-l2-east*.
   The anchor id is shown because one space can hold two codes at opposite ends.
2. **Route.** Ask for "pharmacy". The route is computed over the compiled graph,
   on-device, and drawn across the floor plan with turn-by-turn steps.
3. **Step-free.** Toggle accessible routing and the route changes under you.
   Checked in on Level 2, the pharmacy on the ground floor is 79 m via the South
   Public Stair, or 91 m via the Panoramic Atrium Lift with step-free on. If a
   step-free path cannot be *proven* — a lift out of service, a portal with no
   accessible attribute — it refuses rather than quietly routing you up a
   staircase.
4. **Offline.** Turn off the network and do it again. Nothing changes.

## Why the codes are generated, not authored

`npm run codes` regenerates `public/check-in-codes.html` from the compiled
packages. A printed sign can therefore only ever encode a payload the venue
actually publishes; recompile a venue and a sign that stops resolving shows up
as a diff rather than as a mystery in a corridor.

Every payload is round-tripped through the same decoder an iPhone uses, in
`qrRoundTrip.test.ts`, so a code that would not scan fails the build rather than
the demo.

## What is deliberately not claimed

Check-in gives a **fix at a known point**, not continuous tracking. Between
codes there is no live position — dead reckoning from phone sensors exists in
`localization-core` but is not admitted as evidence, and the accuracy of a
browser-derived walk has never been measured in a real building. See
[Known seams](architecture/known-seams.md).

The venues shipped here are synthetic benchmarks. No accuracy figure in this
repository comes from a real building.
