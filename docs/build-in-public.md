# Build-in-public notes and post drafts

## What to post

Post decisions, evidence, and uncomfortable limitations. Avoid posting a weekly feature inventory with no proof.

A useful update usually contains:

1. The specific problem you found
2. The tradeoff or decision you made
3. One artifact: a test, trace, short clip, benchmark, or diagram
4. What still fails
5. One narrow request for expert review

Keep screenshots secondary to the technical point. The project will stand out when people can see that failures are measured and design claims are constrained.

## Post 1: reopening the project honestly

Suggested LinkedIn or long-form post:

> I reopened an indoor hospital-navigation project I had left unfinished.
>
> The honest assessment: it had a useful graph model and route UI, but no user localization, one fictional floor, and a camera overlay that I had called AR even though it was only a floating 2D arrow.
>
> I preserved that version as `prototype-v0` and started rebuilding from the foundations. The first changes are now public: a reproducible CI gate, a typed A* core, graph invariants, and a persistent route worker. I also renamed the camera experience to “Camera Preview.” Real AR will earn that label only when it has pose alignment, world anchors, progress gates, and relocalization.
>
> The next milestone is a versioned two-floor spatial schema and compiler. I would especially value criticism from people who have worked with IndoorGML, BIM/IFC conversion, hospital accessibility, or indoor localization. What invariant would you insist on before trusting a compiled building graph?

Short version for X/Bluesky:

> Reopened an old indoor-navigation project and started with the uncomfortable fixes: preserved `prototype-v0`, replaced mismatched Dijkstra/A* code with one tested A* core, added graph invariants, and stopped calling a floating camera arrow “AR.” Next: a versioned two-floor spatial compiler. Indoor GIS/SLAM reviewers welcome.

## Post 2: the routing-core decision

> A subtle problem in my indoor-navigation prototype: the file named “routingEngine” described A*, but the Web Worker actually ran Dijkstra and generated different instructions. Tests against the main module would not have tested production behavior.
>
> I split the system into a pure TypeScript routing core, a thin worker transport, and a persistent request facade. The worker and tests now execute the same function. The current Lobby → Pharmacy fixture is 129 m and produces asserted turn types; accessibility constraints are tested on a graph where the shortest edge is intentionally inaccessible.
>
> This is still a small graph, so the interesting question is not whether A* is fast here. It is whether the boundary will survive versioned multi-floor packages and dynamic closures. If you have shipped graph workers in the browser, I would appreciate feedback on package initialization and cache invalidation strategies.

Attach:

- A small diagram from the README
- The exact route test, not a codebase screenshot
- A 10–15 second clip of the turn list updating

## Post 3: the first compiler failure

Do not wait until the compiler succeeds. The first useful compiler post should show a rejected building fixture.

> The spatial compiler rejected my first two-floor fixture today. That is the feature.
>
> One lift portal was aligned visually but referred to a different connector ID on the upper floor. A renderer could hide that mistake; routing would silently create an unreachable island. The compiler now emits a stable validation issue and fails the package build.
>
> Current invariants: [list only the implemented ones]. Next I am testing door-to-space membership and accessible reachability. For people working with BIM or indoor GIS: which topology errors appear most often in real source data?

Attach the invalid source fragment and its machine-readable validation result.

## Post 4: one package, no parallel graph

Before localization, publish the package-integration milestone:

> The hardest part of replacing my old indoor-navigation demo was not drawing two floors. It was deleting the second source of truth.
>
> The app used to have handwritten room geometry, a separate graph, and UI-specific POI data. They could disagree while the screen still looked plausible. The rebuilt path is now: versioned source → validating compiler → content-addressed package → 2D map, 3D inspector, search, and route worker.
>
> The synthetic reference package currently compiles to 20 semantic spaces, 55 routing nodes, and 55 edges. Visitor search excludes staff-only POIs; restricted edges fail closed; and an accessible ground-to-Level-1 route is asserted to use the lift rather than stairs. Recompilation must reproduce the same SHA-256 package hash.
>
> This is still reference data, not a surveyed hospital and not a localization claim. The next review target is the operational-overlay design: how should closures be versioned, expired, and explained in a route receipt?

Attach:

- A 15–25 second clip switching floors, selecting a 3D semantic space, and showing an accessible cross-floor route
- The package hash and deterministic compile check
- A small diagram showing one package feeding the 2D map, 3D inspector, search, and worker

Suggested short version:

> Deleted the parallel mock graph from my indoor-navigation project. One compiled package now drives the 2D map, 3D inspector, public POI search, and multi-floor route worker. Accessible routes use the lift; restricted edges fail closed; builds reproduce the same package hash. Still synthetic data—next up: versioned closures + route receipts.

## Post 5: localization evidence

Only publish accuracy numbers with the trace, device, route length, checkpoints, and method.

> First replayable localization walk: [building/route], [device], [distance]. Median horizontal error: [x]. p95: [y]. The filter lost confidence near [location] and correctly froze guidance instead of pretending the pose was exact.
>
> This result is not yet general. The trace and evaluation command are linked below. I am looking for feedback on [one filter or map-matching choice].

Never post a lone “95% accurate” number.

## Post 6: replacing the toy demo without pretending it is real

Suggested LinkedIn post:

> The 3D view in my indoor-navigation project used to be “3D” in the least useful
> sense: room polygons extruded by a few centimeters. It exposed topology, but it
> still looked like a stack of floor plans.
>
> I rebuilt that slice in three reviewable commits.
>
> First, the renderer now derives full-height walls from semantic polygons, cuts
> openings from compiled portal widths, and adds doors, restricted gates, lift
> shafts, stairs, equipment cues, lighting, shadows, labels, floor isolation, and
> an exploded cutaway.
>
> Second, I compiled Asterion University Medical Center: an original fictional
> four-level benchmark with 60 semantic spaces, 56 portals, 36 POIs, 9 localization
> anchors, 168 routing nodes, and 176 edges.
>
> Third, I moved the live app onto that package and tested a dual-lift outage. A
> standard route to cardiology falls back to the public stairs. The wheelchair
> profile returns “No compliant route” instead of drawing a route it cannot defend.
> The route receipt records the package hash, policy profile, applied closures, and
> selected connector.
>
> Important limitation: Asterion is not a real hospital and is not a copy of one.
> Public hospital maps and healthcare-wayfinding guidance informed the design
> patterns, but the geometry and names are invented. This is a more demanding
> software benchmark while I work toward permissioned surveyed data—not a physical
> navigation claim.
>
> I would value review from hospital wayfinding, indoor GIS, accessibility, or
> digital-twin engineers: what should the next benchmark scenario try to break?

Suggested short version:

> Replaced the “extruded floor plan” in my indoor-navigation project with a
> four-level architectural cutaway driven by one compiled package: 60 spaces, 56
> portals, 168 nodes, deterministic closures, and auditable route receipts. A
> dual-lift outage reroutes standard users to stairs and fails closed for wheelchair
> routing. Fictional benchmark, not surveyed data. Review welcome.

Attach:

- A 15–25 second clip: 2D floor switch → 3D exploded view → isolate Level 1
- A second clip: enable lift outage → standard stair reroute → wheelchair failure
- The three commit links, so reviewers can inspect the progression rather than one
  opaque code dump

## Post 7: the visual rewrite had to expose more truth, not just look newer

Suggested LinkedIn post:

> I was unhappy with the interface of my indoor-navigation project. It had the
> familiar dark gradients, glowing controls, rounded glass cards, and a map made
> from saturated rectangles. It looked generated before it looked trustworthy.
>
> I rebuilt the presentation in four independently tested commits.
>
> 1. A restrained interface system: neutral surfaces, thin dividers, compact
>    controls, one interaction color, and typography closer to an operations tool.
> 2. An architectural 2D renderer: room codes, modeled openings, door swings,
>    circulation hatching, structural references, and an orange/black route that
>    stays readable over the plan.
> 3. A selected-route overlay in the 3D twin. Orange is horizontal travel; violet
>    is movement between floors. It is deliberately separate from the full graph
>    debug overlay.
> 4. A route-aware camera-guidance preview with camera, heading, position, and
>    world-anchor readiness shown explicitly.
>
> The last point matters: this is still not world-anchored AR. A supported device
> can compare compass heading with route bearing, but there is no surveyed
> building-to-world transform or live user localization yet. The UI now makes
> those missing capabilities visible instead of hiding them behind a floating
> arrow.
>
> Every commit passed the same gate: lint, TypeScript, 70 tests, deterministic
> package compilation, localization replay verification, and production build.
>
> I would value a hard review from indoor GIS, wayfinding, BIM, or AR engineers:
> which visual element still suggests more confidence than the underlying system
> has earned?

Suggested short version:

> Reworked my indoor-navigation prototype in four tested commits: restrained UI,
> architectural 2D plan, selected route through the 3D twin, and route-aware camera
> guidance with explicit readiness states. It can use device heading, but it is
> still not world-anchored AR—and the interface says so. Review welcome.

Attach:

- A split-screen before/after of the Ground floor
- A 10–15 second clip of one route in 2D, then the same route across floors in 3D
- A mobile clip showing the guidance-readiness panel before and after enabling heading
- Links to the four commits instead of one large diff

## Where to share

- LinkedIn: decisions, pilot context, and calls for domain reviewers
- X or Bluesky: concise progress, diagrams, and test artifacts
- Reddit communities related to GIS, computer vision, AR, and web development: detailed technical write-ups; read each community's self-promotion rules first
- GitHub Discussions or issues: design questions with a concrete proposal and acceptance criteria
- A personal devlog: durable benchmark reports and architecture decisions

## Cadence

Post when a milestone produces evidence, usually once or twice per week. Small Git commits can remain frequent; public posts should be selective.

A strong repeating cadence is:

- Decision post
- Failure or validation post
- Working slice video
- Benchmark or replay report

## Language to avoid

Avoid “revolutionary,” “AI-powered navigation,” “production-ready,” and “world-class.” Avoid claiming real-time localization, AR, accessibility safety, or offline operation until the repository contains the corresponding evidence.

Prefer:

- “implemented in this fixture”
- “measured on this device and trace”
- “prototype limitation”
- “target, not yet a claim”
- “review requested on this invariant”
