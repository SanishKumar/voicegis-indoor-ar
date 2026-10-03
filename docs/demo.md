# The 60-second demo

What this shows: **a stranger walks into a building, scans one code, and gets a
step-free route to a published public destination — with no beacons, no RF
fingerprinting, and no positioning service.**

"Any room" would be wrong twice over: the runtime offers published public POIs
rather than every space in the model, and a step-free request that cannot be
proven is refused rather than answered. Both are deliberate.

Everything routing needs is inside a compiled venue package sealed with a
content hash. Once it is loaded, check-in and routing run entirely on the
device: there is no lookup service behind them and nothing to call home to.

Three things that claim does **not** include, because they would not survive a
careful reader:

- **It is not survey-free.** No beacons are installed and no RF fingerprinting
  is needed, but each code still has to be _placed where the package says it
  is_. That is a tape measure against two walls per sign. What is avoided is
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
   _Checked in at Family Care Concourse · Level 2 · anchor-l2-east_. The anchor
   id is shown because one space can hold two codes at opposite ends.

   How closely that matches the real world is a property of how carefully the
   sign was placed, and has never been measured in a building. Do not quote a
   figure for it.

2. **Route.** Ask for "pharmacy". The route is computed over the compiled graph,
   on-device, and drawn across the floor plan with turn-by-turn steps.
3. **Step-free.** Toggle accessible routing and the route changes under you.
   Checked in on Level 2, the pharmacy on the ground floor is 79 m via the South
   Public Stair, or 91 m via the Panoramic Atrium Lift with step-free on. If a
   step-free path cannot be _proven_ — a lift out of service, a portal with no
   accessible attribute — it refuses rather than quietly routing you up a
   staircase.
4. **Cold reload offline.** Build and preview the deployable visitor shell once
   while online (`npm run build`, then `npm run preview`) and wait for **Offline
   ready** in the status bar. In Chromium DevTools, set **Network → Offline**;
   turning off Wi-Fi alone does not disconnect a server on `localhost`. Close
   the tab, open a fresh one at the same preview URL, and repeat check-in,
   routing, and floor switching. The app shell and bundled releases come from
   the revisioned service-worker cache; the active IndexedDB package is
   independently re-hashed before fallback activation.

   This does not make a first-ever offline visit possible. Installation needs
   one completed online load, arbitrary remote VenuePackage URLs remain subject
   to their origin and availability, and production hosting must be HTTPS (a
   sub-path needs a build with that base; see docs/deployment.md). The
   automated browser gate repeats fresh-page check-in and routing, and floor
   switching with Chromium's network disabled. It separately proves that a
   corrupted IndexedDB package is refused.

## The campus: from a room in one building to a room in another

The catalog opens on Asterion, one building. The second demo is Meridian Park
Medical Campus: three buildings round a garden, with the walks between them
routed like corridors. Reach it from the first screen with **Somewhere else?
Choose the place**, or by its link:

```text
http://localhost:3000/?venue=/venues/meridian-park-campus.package.json#/visitor
```

1. **Outside.** With nowhere to stand yet, the map is the whole site: each
   building a block with its name on it, among the lawns, the pond and the car
   park. Press a building and its roof comes off to show its rooms, furnished
   by what they are for.
2. **By a sign.** Open the link a sign inside the Emergency Centre would carry:

   ```text
   http://localhost:3000/?venue=/venues/meridian-park-campus.package.json&checkin=voicegis://meridian/g/emergency-entrance#/visitor
   ```

   On a first visit the app says _You are at Emergency Entrance_ and asks only
   where to go. It does not ask where you are.

3. **Between buildings.** Ask for the Rehabilitation Gym. The route leaves the
   Emergency Centre, follows the West Garden Walk, goes round the fountain and
   into the Wellness Pavilion, 162 m, with each place labelled by its building.
4. **Between floors and buildings.** Set the start to the Dialysis Unit on
   Level 2 and ask for the gym again: 201 m, down the Main Stairs, out through
   the Main Entrance Hall and across. In 3D, **Route overview** stacks the
   floors and frames the whole trip. Step-free takes the Main Lifts instead.

Like Asterion, the campus is a constructed model. Its distances are properties
of that model and its furniture is illustration, not survey.

## Why the codes are generated, not authored

`npm run codes` regenerates `public/check-in-codes.html` from the compiled
packages, and `codes:check` fails the build if the committed sheet no longer
matches them. So the sheet in the repository can only ever encode payloads the
venue publishes.

It cannot keep paper current. A sign already printed and stuck to a wall is
outside version control, so recompiling a venue can strand it silently — the
repository is consistent and the corridor is not. Reprinting after a venue
change is a field procedure, not something a gate can enforce.

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
