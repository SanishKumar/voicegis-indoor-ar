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

## Post 4: localization evidence

Only publish accuracy numbers with the trace, device, route length, checkpoints, and method.

> First replayable localization walk: [building/route], [device], [distance]. Median horizontal error: [x]. p95: [y]. The filter lost confidence near [location] and correctly froze guidance instead of pretending the pose was exact.
>
> This result is not yet general. The trace and evaluation command are linked below. I am looking for feedback on [one filter or map-matching choice].

Never post a lone “95% accurate” number.

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
