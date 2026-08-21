# The 60-second demo

What this shows: **a stranger walks into a building, scans one code, and gets a
step-free route to any room — with no beacons, no RF fingerprinting, and no
positioning service.**

Everything routing needs is inside a compiled venue package sealed with a
content hash. Once it is loaded, check-in and routing run entirely on the
device: there is no lookup service behind them and nothing to call home to.

Three things that claim does **not** include, because they would not survive a
careful reader:

- **It is not survey-free.** No beacons are installed and no RF fingerprinting
  is needed, but each code still has to be *placed where the package says it
  is*. That is a tape measure against two walls per sign. What is avoided is
  hardware and a radio survey, not knowing where things are.
- **The bundled venues are synthetic.** Asterion and the reference building are
  authored fixtures, so any distance quoted below is a property of a constructed
  model, not a measurement of a real corridor.
- **Asterion was authored as JSON, not compiled from CAD.** A DXF import path
  exists in `packages/dxf-importer` and is exercised by fixtures in
  `buildings/import-fixtures`, but the venue in this demo did not come through
  it.

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

1. **Scan.** A code at a corridor junction resolves to the anchor the package
   declares: floor, position, heading. The app says where it thinks you are —
   *Checked in at Family Care Concourse · Level 2 · anchor-l2-east*. The anchor
   id is shown because one space can hold two codes at opposite ends.

   How closely that matches the real world is a property of how carefully the
   sign was placed, and has never been measured in a building. Do not quote a
   figure for it.
2. **Route.** Ask for "pharmacy". The route is computed over the compiled graph,
   on-device, and drawn across the floor plan with turn-by-turn steps.
3. **Step-free.** Toggle accessible routing and the route changes under you.
   Checked in on Level 2, the pharmacy on the ground floor is 79 m via the South
   Public Stair, or 91 m via the Panoramic Atrium Lift with step-free on. If a
   step-free path cannot be *proven* — a lift out of service, a portal with no
   accessible attribute — it refuses rather than quietly routing you up a
   staircase.
4. **No network round-trip.** With the app already loaded, turn off the network
   and do it again: check-in, routing and floor switching are unchanged, because
   all of it is computed against the package already in memory.

   This is not yet a cold-start offline app. There is no service worker, so a
   reload with the network down fails at the point it fetches the venue package.
   The registry stores verified packages in IndexedDB; wiring that to a service
   worker so a first paint can come from cache is not done.

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
