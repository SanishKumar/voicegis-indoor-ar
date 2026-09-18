# Visitor navigation: from route preview to dependable guidance

Reviewed 11 September 2026. Scope: Visitor first; preserve Studio, Inspector, the compiler, accessibility policy, offline delivery, and evidence integrity. This is an implementation sequence, not a promise that browser sensors already provide reliable indoor positioning.

## Product direction

The destination experience should feel simple: choose a place, establish a starting position, see one useful instruction, and follow it. A person can inspect the full journey, return to their position, tilt into 3D, or briefly raise the camera without restarting navigation. The system advances instructions only when observations support movement. When it cannot locate the person confidently, it explains what happened and offers a quick recovery.

Our differentiator should be dependable venue-specific guidance: the correct public entrance, understandable landmarks, step-free routes that respect current closures, clear floor changes, and a graceful response when location is uncertain. More animation is not a substitute for those fundamentals.

## Review of “One Kernel, Three Cameras”

The [proposal](https://claude.ai/code/artifact/dbab029f-5074-470f-8b9e-9e1a8488066a) has the right central idea: a shared journey, several presentations, confidence-aware guidance, and AR as an enhancement. Keep that direction, with these corrections:

1. **Useful localization components exist, but the hard part is not finished.** `packages/localization-core` provides filtering, dead reckoning, map matching, orientation conversion, replay, and runtime quality policy. The Visitor's shared navigation context did not consume live pose estimates. Its `currentStepIndex` represented button presses. The sensor adapter records observations; it is not a field-validated live navigation service.
2. **The current views already share some route state.** This is an evolution of the existing context, not a greenfield merger of three independent routing engines. The Visitor map already has a real Three.js scene. Inspector remains an operator tool; do not silently fold its controls into the public experience.
3. **Coordinate and motion semantics are blockers, not wiring details.** Routing bearings use a Y-down convention; filter movement uses a Y-up convention. Asterion declares a north offset. Define and test the transformations among device, magnetic/true heading, building coordinates, and renderer coordinates. A QR payload identifies a surveyed point, not the handset's viewing direction or a six-degree-of-freedom camera pose.
4. **Do not extrapolate motion indefinitely.** Audit the filter's retained velocity when the visitor stops, observation age, and dead-reckoning behavior across interruptions. Existing quality deadlines (including 5/15-second transitions) are implementation policy, not field-validated navigation guarantees.
5. **Map matching helps, but can confidently choose the wrong corridor.** Nearest-segment matching and a backward clamp are insufficient around crossings, loops, adjacent corridors, unexpected turns, and floor transitions. Matching only the intended route can conceal a real deviation. Test forward jumps, ambiguity and off-route evidence independently of the route we want the person to take.
6. **Published PDR figures are not our accuracy budget.** The cited [2016 study](https://pmc.ncbi.nlm.nih.gov/articles/PMC4721747/) combines particular sensors, corrections and filtering. The [2023 paper](https://arxiv.org/abs/2301.03471) uses visible-light positioning to calibrate PDR. Neither establishes “under 2%” for this browser, these users or these venues. Corridor width constrains lateral uncertainty only when the correct corridor is known.
7. **Nine anchors do not justify a universal replacement count.** The inspected Asterion package has nine anchors across four floors. “8–12 per floor” is an unvalidated suggestion. Survey decision points, travel distances, floor transitions, lighting, sign reachability and measured uncertainty first. Reprint when encoded identity or surveyed placement changes—not automatically on every unrelated package recompile.
8. **AR is capability-dependent.** A WebKit engineer states that iOS WebXR is unsupported in the [March 2026 issue](https://bugs.webkit.org/show_bug.cgi?id=309550); later [WebKit work](https://commits.webkit.org/313648@main) describes an iOS prototype, not a public shipping guarantee. Do not promise Safari world-anchored AR. Android WebXR also requires supported hardware, services, browser and secure delivery ([ARCore requirements](https://developers.google.com/ar/develop/webxr/requirements)). Use capability detection and tested devices, not OS-name guesses. Native iOS AR is a separate product decision.
9. **Never bend a route around a trolley just for appearance.** A line implies a traversable path. A cosmetic 1.5 m offset could lead through a wall, restricted space, steps, or insufficient wheelchair clearance. Separate closure-aware graph routing, depth-based rendering/occlusion, and genuinely validated local obstacle avoidance.

## What to borrow from major products

| Pattern                  | Visitor adaptation                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Preview before travel    | Destination, selected start, route length, approximate duration, floor transitions and accessibility before asking for sensors.         |
| One instruction in focus | Large maneuver text and distance; full turn list available without burying the map.                                                     |
| Follow versus browse     | Panning/inspecting never changes position. A recenter control returns to the last checkpoint or, later, a trusted live estimate.        |
| Adaptive camera          | Overview for planning, forward context near turns, deliberate transitions between 2D and 3D. Keep the same route revision and location. |
| Camera as a brief aid    | Useful at ambiguous decisions; navigation still works when the camera is down, denied, unsupported or interrupted.                      |
| Destination context      | Correct entrance, floor, recognizable landmark and an honest arrival state—not merely the final graph node.                             |

These adapt the [Apple walking flow](https://support.apple.com/en-gb/guide/iphone/iph8eae299d1/ios), [Google Lens walking guidance](https://support.google.com/maps/answer/9332056), and separation of [route progress](https://docs.mapbox.com/android/navigation/guides/turn-by-turn-navigation/route-progress/) from [camera state](https://docs.mapbox.com/android/navigation/guides/ui-components/camera/). Google's [2026 immersive navigation](https://blog.google/products-and-platforms/products/maps/ask-maps-immersive-navigation/) is a useful visual reference, but driving features are not evidence of equivalent indoor positioning capability. This review used the public product descriptions, not a claim of hands-on testing inside those native apps.

## Shared architecture

```text
Venue package + active accessibility/closure policy
                       ↓
                 Route service
                       ↓
QR / validated sensor observations → Journey session → 2D map
                                      │             → 3D camera
                                      │             → capability-gated AR
                                      └─────────────→ text / voice / recovery
```

Separate four things explicitly:

- **Route intent:** destination, start used for planning, accessibility profile, package/overlay identity, route revision and cancellation generation.
- **Location evidence:** last checkpoint and timestamp; later pose, observed floor, uncertainty, heading provenance, observation age and tracking capability. Never persist a live position as current across a reload.
- **Guidance progress:** matched route distance, maneuver index, confidence, off-route evidence and arrival evidence. This is not a camera or button index.
- **Presentation:** inspected instruction, displayed floor, follow/browse state, camera mode and detail-sheet expansion.

High-rate observations should not force the entire React tree to render. Let the session reduce observations deterministically and publish stable guidance snapshots; renderers interpolate only validated presentation data. Choose the update rate after measuring latency and battery use, not because “10 Hz” sounds plausible.

## Stepwise delivery plan

The dependency order is deliberate: establish truthful journey state, then validate observations, then let observations control guidance. Visual design and landmark authoring from step 4 and physical surveying from step 8 can proceed alongside localization work after this first slice is reviewed. Existing closure-policy improvements do not need to wait for AR. World-anchored rendering and dynamic avoidance remain separately gated.

### 1. Honest, shared Visitor journey — this implementation slice

Deliver:

- Typed journey state/reducer with `previewStepIndex` distinct from planning location and `locationFloorId` distinct from displayed floor.
- Compact map-first directions on desktop and phone; route totals do not shrink when browsing instructions; full exact turns remain available.
- Explicit Route preview labeling. Reaching the last instruction does not declare arrival. An “I'm at my destination” action records user-confirmed arrival.
- A fixed checkpoint marker at the authored QR coordinate, not the nearest graph node or preview step. Manually selected starts are labeled differently; venue defaults do not produce a measured-location marker.
- Recenter to that checkpoint/start. Switching floors or camera views does not change it. Dismissing confirmation does not erase location provenance.
- A valid new scan keeps an active/pending destination and replans using the current route policy. Invalid scans do not destroy the journey. Cancel rejects late results.
- Small-phone floor/zoom controls clear the route sheet. Camera readiness information clears the measured height of its wrapping controls, keeping the return-to-map action tappable.

Acceptance: reducer and provider race tests; marker-source tests; production browser coverage for final-preview versus arrival, stable totals, floor browsing/recentering, small-phone controls and existing journeys. No automatic sensor enrollment, inferred live motion, compiler changes or deployment in this slice.

Why this first: the current experience must tell the truth before continuous tracking is allowed to drive it. This is the foundation, not the finished visual redesign or the requested automatic navigation feature.

### 2. Establish the localization contract and replay safety

1. Define units, axes, north offsets, timestamp source, heading provenance and floor identity at every adapter boundary. Add known-bearing tests for all four cardinal directions and rotated venues.
2. Decouple anchor position from handset heading. Require explicit heading calibration or a measured pose; represent unknown heading as unknown.
3. Test stationary periods, rotation without translation, acceleration bias, pocket/handheld carriage, pauses, hidden tabs, camera interruptions and timestamp gaps. Stop propagation or freeze when evidence is insufficient.
4. Extend matching with physically plausible progress bounds, junction ambiguity, wrong-turn evidence, loop/crossing continuity, and explicit floor-transition policy. Never change floors just because a route step says to.
5. Record deterministic replays for these failure cases. Keep synthetic/device-frame captures distinct from independently surveyed accuracy evidence.

Acceptance: no motion from instruction browsing; no continued travel after an interruption; no silent jump between adjacent corridors/floors in adversarial fixtures; every estimate exposes freshness and uncertainty. Field accuracy is still unproven at this gate.

#### Phase 2, slice A: step-driven motion accounting

Implemented 11 September 2026, without enabling live Visitor tracking:

- The filter applies each detected stride's displacement exactly once. It does
  not extrapolate the previous stride on heading/floor events or across a gap.
- Position corrections can move the estimate, but do not establish ongoing
  walking. Non-step frames publish zero velocity (no velocity observation, not
  proven physical stillness).
- The existing covariance-aging model and quality thresholds remain unchanged.
  Heading events do not refresh position-correction age; sufficiently stale
  observations still yield lost quality and frozen replay guidance.
- Fifteen new synthetic regressions cover stopped/rotating traces, heading
  cadence, turns, floor observations, same-time events, corrections, zero-length
  strides, gaps and the IMU-to-replay path. All fifteen failed against the actual
  pre-change filter before the fix: a 30-second gap invented 30 metres of travel,
  and interleaved headings inflated two one-metre strides to 2.75 metres.
- Evidence processor version is now 0.3.0, because identical capture inputs can
  produce different estimates. Existing synthetic expected errors were updated
  from explicit stride arithmetic, not treated as an accuracy improvement.
  Policy, capture/recording schemas, venue packages and sensor eligibility are
  unchanged; old processor artifacts must not be silently relabelled.

This is a bounded first slice, **not completion of Phase 2**. Next: define the
venue/device coordinate and heading-provenance boundary, decouple QR position
from phone heading, and stop stale IMU integration across interruptions. Then
add matching/floor-transition gates. Live-session watchdogs and real-device
validation remain required before automatic maneuver progress. No Visitor
adapter is connected by this slice.

#### Phase 2, slice B: coordinate and heading-reference boundary

Implemented locally after slice A, preserving its uncommitted changes:

- Added explicit plan/filter coordinate transforms, directional-axis and
  reference-frame types, provenance-aware true/magnetic/plan heading conversion,
  uncertainty and timestamp gates. Tested all cardinal directions through the
  actual router and reflected filter, plus rotated-map and wraparound cases.
- Fixed the existing camera preview's false “Aligned” claims from relative alpha
  and uncalibrated magnetic compass values. Unknown direction stays unknown;
  the current browser preview remains screen-aligned. QR and route bearings are
  not used to calibrate the phone.
- Added explicit sensor-disable, stale-event expiry, background pause and
  late-permission cleanup for heading diagnostics only. This is not a live
  positioning adapter or an IMU continuity fix.
- Kept existing venue north-offset metadata separate from measured alignment.
  It must acquire explicit semantics and survey/calibration provenance before
  it can support true-north guidance. No venue artifacts were rewritten.
- Stacked mobile readiness values beneath their labels after a continuous-event
  browser regression reproduced clipping of “Uncalibrated” at 320 px.

See [the heading contract](localization/visitor-heading-contract.md) for formulas,
source documentation, browser behavior and deliberately unresolved boundaries.
Slice C below implements the position-only / separate-heading recording contract
and corresponding replay refusals. Automatic Visitor movement remains disabled.
Phase 2 is still incomplete.

#### Phase 2, slice C: position-only checkpoints and versioned replay

- QR/NFC scans now emit position and floor only; they do not initialize or
  correct phone heading and do not reset integrated gyro direction.
- Recording 0.2 requires null initial heading and a separate independent,
  venue-bound travel-axis calibration. Inertial updates cannot establish
  initial direction. Unknown heading is explicit, freezes guidance and prevents
  stride displacement; later calibration does not replay missed strides.
- The filter enforces the same contract when called directly, including its
  explicit frame identity. Existing lost/relocalizing recovery cannot be bypassed
  by clearing and recalibrating heading.
- Raw capture 0.2 remains readable and unchanged. It lacks an independent
  calibration event, so processor 0.4 / policy 0.3 withhold accuracy. Otherwise
  eligible walks report `unverified-heading`; other refusal precedence remains.
- Recording 0.1 and earlier evidence versions are not silently relabelled. The
  synthetic reference is deliberately authored as 0.2 with separate calibration;
  real calibration cannot be inferred from legacy numeric heading fields.

See [the migration and compatibility notes](localization/position-only-recording.md).
The user reprioritized the bounded 2D/3D presentation slice below ahead of
interrupted IMU continuity/reset semantics; slice D now follows that presentation
work. A future raw
calibration/pose event, surveyed alignment and physical-device timing validation
are still required before accuracy reporting or automatic Visitor progress.

#### Phase 2, slice D: interrupted IMU continuity

- Missing/non-finite heading rates invalidate direction before any same-sample
  step. Full interruptions discard incomplete peaks and pre-interruption timing.
- An explicit sample-gap limit (default 1,000 ms, inclusive) is separate from
  stride-duration tuning. Duplicate timestamps cannot complete a footfall.
- Replay consumes independent visibility, sensor and permission gates in causal
  order; resuming one does not reopen the others. QR/NFC cannot resume or calibrate.
- The handset recorder writes visibility boundaries, requires fresh tilt after
  return, and cleans up listeners and pending permission starts on exit.
- Processor 0.5 / policy 0.4 preserve raw capture/recording 0.2 compatibility;
  older artifacts require their original build. No accuracy evidence is admitted.

See [the contract and remaining boundaries](localization/imu-continuity.md).
Slice E below adds bounded route/floor safeguards. Live
silence detection, raw partial-sample/calibration semantics and physical-device
validation remain required before enabling automatic Visitor progress.

#### Phase 2, slice E: bounded route matching and floor safety

- Route-scoped matching retains a progress high-water mark and refuses large
  forward increments, same-time advances, disconnected segment changes and
  ambiguous crossing/parallel/retraced route legs. Straight subdivisions and
  shared endpoints remain usable. These are conservative software gates, not
  validated speed, clearance or positioning models.
- Rejections cannot advance the cursor. Once route-bound, runtime updates and
  explicit relocalization require an accepted match for the current estimate;
  stale matches and omitted gates cannot resume guidance.
- Unqualified floor/elevation claims retain the confirmed floor, freeze movement
  and expose a pending transition. An adjacent, same-time anchor position/floor
  pair can confirm/reacquire floor, but never proves a stair/lift traversal or
  silently moves the route cursor to another floor.
- Processor 0.6 / policy 0.4 keep capture/recording 0.2 formats; historical
  artifacts require their original build. Only the synthetic reference report's
  rejection-counter vocabulary changed. No Visitor movement is enabled.

See [the route/floor contract](localization/route-matching-safety.md).
Slice F below implements the shared session/freshness and reacquisition substrate.
Whole-venue off-route alternatives, typed connector
evidence, independently surveyed calibration and physical/mobility validation
remain prerequisites for automatic guidance; Phase 2 is not yet complete.

#### Phase 2, slice F: live-session freshness and explicit reacquisition

- Added an in-memory controller owning filter, matcher and runtime for one exact
  venue/package/route revision. It is not yet connected to Visitor or browser sensors.
- Every read/input checks motion occurrence age; a late sample cannot conceal a
  prior timeout. Hidden/permission/sensor/floor interruptions, quality loss and
  route rejection retire the acquisition lease and freeze progress.
- Recovery requires a new explicit acquisition and an internally resolved fresh
  checkpoint, then independent travel heading and a qualified complete motion
  sample. Old callbacks, copied leases and another route's lease cannot resume it.
- Position/floor/matcher acquisition commits together; it can reacquire a floor
  but never proves a connector traversal. Old heading is not carried across scans.
- Duplicate or overlapping strides and intervals predating acquisition/calibration
  cannot move the visitor. Detached snapshots retain last-known diagnostics but
  expose no usable progress while frozen. An optional diagnostic watchdog has
  explicit disposal and stopped/error cleanup.
- Replay/evidence behavior and versions are unchanged by this slice. The new
  1,500 ms timeout and 500 ms delivery limit are software policy, not device claims.

See [the live-session contract](localization/live-session.md). Slice G1 below
starts its operator-only integration. Keep public Visitor progress manual until
the remaining validation gates are met; neither a synthetic harness nor this
controller establishes field accuracy.

#### Phase 2, slice G1: checkpoint-only operator integration

- Added a **Checkpoint session** diagnostic under **Record** in the operator
  build. It reads the selected Visitor route without receiving navigation actions.
  The public build excludes the panel and its preparation module.
- Starting verifies package bytes, recalculates the current route policy and
  constructs filter-local segments/anchors from canonical geometry. Changed
  package/route/profile/closure bindings retire the old owner. Pending integrity
  results cannot enroll after stop, backgrounding or unmount.
- Manual authored-payload tests exercise checkpoint refusal, resolution, silent
  expiry and explicit reacquisition. The last checkpoint is diagnostic only;
  no heading is inferred and guidance always stays frozen. The panel never
  requests cameras or sensors and never starts the separate walk recorder.
- Stop/unmount dispose the watchdog. Hidden/pagehide interrupts the session;
  foregrounding alone cannot resume it. This is an in-memory diagnostic, not
  measured capture or field accuracy evidence. Evidence versions are unchanged.

See [the harness guide](localization/operator-session-harness.md). Slice G2 below
adds consent-owned handset input without enabling Visitor progress.

#### Phase 2, slice G2: opt-in handset input diagnostics

- Added separate explicit motion/tilt opt-in under the operator checkpoint panel.
  Starting the session alone requests nothing. Both permission requests occur
  within the user action; denial, cancellation, late grants, hidden/pagehide,
  replacement and unmount cannot silently enroll or resume input.
- A lease-bound adapter pairs complete motion with fresh tilt, preserves event
  occurrence clocks, projects gyro rates through the existing device profile and
  resets cached tilt, heading and unfinished strides at recovery boundaries.
  Partial, stale, future, duplicate and regressing input is refused. Timers and
  orientation-only input never manufacture qualified motion heartbeats.
- The panel shows paired/rejected counts and sample age. Guidance stays frozen:
  it has no measured travel-heading source. Continued raw readiness after a
  guidance fault cannot restore the session. Neither compass alpha, route shape
  nor QR orientation is used as calibration.
- The calibrated forwarding API is synthetic-tested but unused by the UI.
  Samples remain in memory, the recorder is separate, the public build excludes
  the new modules, and capture/replay/evidence contracts are unchanged.

See [the input contract](localization/live-handset-input.md). Next is measured
independent travel-heading capture and real-device timing/mobility qualification,
not automatic Visitor progress. Whole-venue off-route evidence, verified
connectors and predeclared pilot gates remain open.

### 3. Continuous standard navigation, behind a pilot gate

1. Connect a consent-based handset observation adapter to the journey session. Start/stop listeners once, clean up reliably, and handle permission denial/revocation and resume.
2. Introduce visible states: **checkpoint only**, **tracking estimate**, **location uncertain**, **tracking paused**. A selected start is a planning input, not the highest confidence tier.
3. Advance maneuvers from observed along-route progress with hysteresis; anticipate the next turn from estimated distance. Require corroboration near junctions and arrival. Keep manual preview separate and optional.
4. Replan only after sustained off-route evidence or changed operational policy. Avoid oscillation, duplicate route requests and stair/lift substitutions that violate the user's profile.
5. Give precise recovery actions: rescan a nearby code, choose a start, retry permission, or continue with the route list. Freeze unsupported movement rather than faking it.

Acceptance: real-device walks on iPhone and Android, including stop/restart, wrong turn, alternate corridor and lift/stair transitions. Measure checkpoint-to-checkpoint drift, false maneuver advances, wrong-floor events, recovery time, update latency and battery impact. Set rollout thresholds from the venue's clearances and decision spacing before the pilot. Zero unsafe false advances in the validation set is a release gate, not a statistical guarantee of zero future failures.

Accessibility gate: validate wheelchair and other mobility patterns explicitly. Do not assume a step detector covers all visitors. Maintain useful checkpoint/list navigation on devices or movement modes the tracker cannot support.

### 4. Finish the premium standard-map experience

1. Design a coherent 2D cartographic style: quiet room fills, useful corridor/entrance hierarchy, readable floor names, restrained route emphasis and collision-aware landmark labels.
2. Build heading-follow and north-up modes, overview/recenter, sensible look-ahead, clear remaining-versus-completed route segments only when progress is trusted, and reduced-motion transitions.
3. Refine the compact sheet, route overview, floor-transition card, uncertain-location state, arrival card and no-route recovery as one visual system.
4. Author landmark-aware language tied to actual venue metadata: “Turn left after Reception,” not invented landmarks. Avoid repeated instructions along collinear nodes.
5. Add opt-in voice, replay/mute, sensible announcement deduplication, screen-reader announcements and optional supported haptics. Speech availability and behavior need device testing; it is not a substitute for visual directions.

Acceptance: a first-time user can plan and finish a test journey without instruction; a seated/one-handed user can reach key actions; keyboard/screen reader and 320 px layouts work; camera and voice permissions are optional. Conduct task-based usability sessions, not just screenshot review.

### 5. Seamless 2D ↔ 3D

**Priority update — implemented before IMU continuity (slice D).** The Visitor
now starts in a true orthographic 2D plan and tilts
into an orbitable orthographic 3D model over the same scene. Mode changes keep
centre, scale, map bearing, active floor, route and inspected instruction.
Reduced-motion users switch immediately. Camera-preview round trips restore
the presentation only for the same package hash; no localization state is
derived from a camera pose.

Cross-floor routes no longer automatically explode the building. The explicit
3D **Route overview** reveals the other route floors; 2D stays on the inspected
floor. **Expand map / Show directions** gives narrow phones room to inspect
the scene while preserving the existing directions and keyboard focus.

The route renderer now uses adjacent graph edges instead of spline smoothing
or floor-filtered joins. Context loss pauses the map with readable directions
still available; restoration or a display retry retains the journey. Missing
WebGL has an honest textual fallback, not a fake 3D view.

See [implementation and validation notes](visitor-map-views.md). Device-specific
performance/quality tiers, surveyed geometry clearance and usability trials are
still open; this does not complete those acceptance gates or enable tracking.

1. Use the same authored geometry and journey snapshot. Make 2D and 3D camera presets over one Visitor scene; keep Inspector separate.
2. Animate camera tilt/zoom while retaining the active route revision, location floor, inspected instruction and follow/browse intent.
3. Show exploded floors for overview only when helpful. During travel, prioritize the current corridor and immediate floor transition rather than a permanently exploded building.
4. Check route drawing against navigable geometry. Smoothing must not cut across corners, walls or missing intermediate-floor segments.
5. Add WebGL context-loss recovery, constrained-device quality levels and a readable non-WebGL route fallback.

Acceptance: round-trip view switching never resets or advances the journey; no position teleportation; visual path remains within verified space; profile mobile frame time/memory and respect reduced motion.

### 6. World-anchored AR as a capability-gated enhancement

1. Prototype on an explicitly tested WebXR/ARCore device set. Validate session support, reference spaces, scale and a surveyed map-to-world alignment. A decoded QR payload alone is insufficient pose calibration.
2. Render the same validated route in world coordinates; use short look-ahead segments, correct floor height, clear turns, conservative occlusion and visible tracking-loss recovery.
3. Keep a map/list escape always available. Stop misleading overlays immediately when pose quality drops. Release camera and sensor resources on exit/background.
4. Label unsupported fallback “Camera preview,” not AR. Do not present a compass as a world anchor. Revisit native iOS only as a separately approved scope decision.

Acceptance: measured alignment at surveyed points, scale/drift tests, relocalization, low-texture/low-light corridors, session interruptions and repeated map↔AR transitions on each supported device. Do not ship merely because an XR session starts.

### 7. Operational obstacles first; perception separately

1. Strengthen known closure reporting: affected space/edge, start/end time, expiry, source and freshness. Reuse the existing route policy and receipts.
2. Explain a changed route and preserve step-free constraints. If no compliant route exists, say so and offer a safe venue contact/recovery path.
3. Treat depth sensing as rendering input initially. [ARCore Depth](https://developers.google.com/ar/develop/depth) and the [WebXR Depth Sensing API](https://www.w3.org/TR/webxr-depth-sensing-1/) do not by themselves establish obstacle classification, traversable clearance or a safe local path.
4. Only investigate dynamic avoidance with a validated traversability model, obstacle lifetime, floor boundaries, mobility-specific clearance and confidence policy. Revalidate every altered route segment against navigable space. Unknown clearance means do not suggest a detour.

Acceptance: timed/expired closures, closed lifts, stale offline closure data, two closures blocking all accessible paths, and recovery when restrictions change. No cosmetic route bending presented as safe guidance.

### 8. Venue pilot and release quality

1. Survey one representative floor plus a multi-floor route. Place anchors at ambiguous decisions and transitions, then tune density from measured recovery needs.
2. Test sign visibility, reachability, placement drift and package/QR identity. Do not imply a nearest-node connector is walkable without checking it against authored geometry.
3. Run observed journeys with unfamiliar users and varied mobility/device conditions. Capture task success, hesitation, wrong turns, scans requested, false confidence and arrival correctness.
4. Verify offline navigation and clearly disclose closure freshness; do not claim offline observations are current operator data. Exercise slow-network installation, reload and package replacement.
5. Establish privacy-minimizing telemetry with explicit consent; no raw camera upload by default. Keep test traces and independently surveyed evaluation artifacts separate.
6. Release gradually with rollback and device/capability restrictions. Preserve the review-before-push workflow.

## Decisions and boundaries

- Proceed web-first with excellent map/list navigation on both iPhone and Android. No native app build is authorized by this plan.
- Preserve the authored venue package as source of truth. IMDF can become an import/export boundary when a concrete integration needs it; it is not a prerequisite for better visitor guidance.
- Preserve Inspector and Studio as operator surfaces. Visitor 3D is not the operator twin UI.
- Do not choose anchor quantities or claim positioning accuracy until a physical pilot provides evidence.
- Keep each implementation bounded for review. Phase 2 begins with motion accounting; complete its remaining coordinate/heading and continuity gates before enabling automatic progress.

## Verification record

Phase 1 was completed at `94ccc91`. At the start of the continuity slice, Phase 2
slices A–C and the bounded 2D/3D presentation work were present in clean HEAD
`3bb408c`. Slices D–F are now implemented in the workspace. Remaining localization,
live guidance, physical validation and later product work are still planned;
presentation switching does not complete all Phase 5 acceptance gates. No commit,
push or deployment was performed in slice D. The verification records below are
historical per-slice results, not claims that every gate was rerun every time.

Phase 1 checks on 11 September 2026:

| Gate                                                                                                                      | Result                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                                           | Passed: lint, type checking, 693 tests across 74 files, all three venue compiler checks, artifact sync, replay, QR sheets and public build. |
| `node scripts/runBrowserSmoke.js --workers=1`                                                                             | 68 passed: desktop/mobile Chromium, Visitor journeys and operator regressions.                                                              |
| `node scripts/runBrowserSmoke.js --public-build e2e/offline.pw.ts --workers=1`                                            | 12 passed: deployable public shell, offline routing, cache verification and recovery.                                                       |
| `node scripts/runBrowserSmoke.js --public-build e2e/offline-install-failure.pw.ts --project=desktop-chromium --workers=1` | 2 passed: first-install failure and update coherence.                                                                                       |
| Visual inspection                                                                                                         | Desktop 1280×800 and small-phone 320×700 layouts inspected; compact directions, recentering, header wrapping and map controls checked.      |

The new provider regression tests were also exercised against an isolated copy of the pre-change context, where the selected check-in/replanning cases failed. Two additional same-event ordering tests first reproduced lost onboarding check-in provenance and a stale accessibility profile, then passed with synchronous planning-intent handling. Temporary baseline copies were removed.

Concurrent runs of the code and browser suites exceeded timing limits in an existing exhaustive route-matrix test and an exact-turn browser journey. The final complete gates above ran sequentially; assertions and existing test timeouts were not relaxed to obtain those passes. The build still reports its existing large-chunk warning, which remains a performance item for the later map/rendering work.

Automated Chromium checks and desktop visual inspection do not establish real-phone positioning accuracy, Safari behavior, accessibility certification or obstacle safety. No live sensor-guided progress, world-anchored AR or dynamic obstacle avoidance is claimed by this slice.

### Phase 2 slice A verification — 11 September 2026

- Before implementation: all 15 new `motionAccounting.test.ts` regressions
  failed against the unchanged filter from `94ccc91`.
- After implementation: all 342 localization-core tests passed, including the
  unchanged invalid-state, capture-integrity and evidence-policy refusals.
- `npm run check` passed: lint, type checking, **708 tests across 75 files**,
  all three venue hashes, artifact sync, reference replay, QR sheets and the
  public production build. The existing large-chunk warning remains.
- `node scripts/runBrowserSmoke.js --workers=1` passed **68 desktop/mobile
  Chromium tests**, including the Visitor journey and operator regressions.
- Project and browser suites ran sequentially; no assertions or timeouts were
  relaxed. The separate offline/install browser suites were not rerun in this
  core-only slice; their Phase 1 results above are historical.
- No UI/sensor enrollment changes, venue recompile, new surveyed evidence,
  commit, push or deployment. Changes remain local for review.

### Phase 2 slice B verification — 11–12 September 2026

- Before the preview change, three new regressions failed against the actual
  unchanged component: relative alpha and magnetic compass produced false
  “Aligned” claims, and an invalid negative compass reading was accepted.
- Added **65 unit tests**: 32 coordinate/reference tests, 20 browser-reading
  tests and 13 component/lifecycle tests. All passed.
- `npm run check` passed: lint, type checking, **773 tests across 78 files**,
  all three venue hashes, artifact sync, reference replay, QR sheets and public
  production build. The existing large-chunk warning remains.
- The full `node scripts/runBrowserSmoke.js --workers=1` run passed **70
  desktop/mobile Chromium tests** before the final narrow-width extension.
- The initial narrow-width assertion could pass after telemetry expired to
  “Stale”. It was corrected to require “Uncalibrated” with continuously emitted
  synthetic compass events. This failed against the unchanged stylesheet and
  passed in both browser projects after the mobile readiness layout correction.
- Four related desktop/mobile browser checks also passed after that correction:
  narrow-width camera controls and returning to the same shared instruction.
- Desktop 1280×800 and mobile 375×812 / 320×700 screenshots were inspected.
  Synthetic camera streams and orientation events test UI behavior only, not
  hardware accuracy or Safari support.
- Offline/install suites were not rerun; their Phase 1 results are historical.
  No automatic positioning, capture-schema migration, venue recompile, new
  surveyed evidence, commit, push or deployment. Changes remain local for review.

### Phase 2 slice C verification — 12 September 2026

- All five initial position-only QR/NFC, marker-rotation and evidence-refusal
  regressions failed against the actual unchanged code before implementation.
  A direct-filter legacy initialization bypass and 14 unqualified calibration
  cases were also reproduced before enforcing the shared boundary there.
- Added **34 tests**. The final `npm run check` passed: lint, type checking,
  **807 tests across 80 files**, all three unchanged venue hashes, artifact sync,
  regenerated synthetic reference replay, QR sheets and public production build.
  The existing large-chunk warning remains.
- **Four targeted desktop/mobile Chromium tests passed** for round-tripping
  between surfaces and opening operator/recorder routes directly, against the
  production operator build. Command:
  `node scripts/runBrowserSmoke.js e2e/layout.pw.ts e2e/public-shell.pw.ts --grep "every surface round-trips|operator routes stay reachable" --workers=1`.
- The full 70-test browser suite and separate offline/install suites were not
  rerun in this core-only slice; their results above remain historical. No
  device sensor enrollment or UI layout change was made by slice C.
- Existing motion/bounds fixtures explicitly declare synthetic calibration now;
  their displacement and numeric safety guards remain exercised. Evidence
  expectations reflect the intentional refusal of uncalibrated capture accuracy,
  not a measured accuracy improvement.
- Previous local work was preserved. No field capture or venue artifact was
  rewritten, no commit/push/deployment was made, and Visitor tracking remains off.

### Phase 2 slice D verification — 12–14 September 2026

- All 19 initial core regressions failed against the actual `3bb408c` code.
  Three initial handset/component regressions also failed before their fixes.
  Both production-browser recorder tests failed against the prior handset/UI
  implementation because exported visibility boundaries were missing.
- Added **44 unit tests**. The final `npm run check`, repeated on 14 September,
  passed: lint, type checking, **864 tests across 84 files**, all three unchanged
  venue hashes, artifact sync, unchanged reference replay, QR sheets and the
  public production build. The existing large-chunk warning remains.
- The full `node scripts/runBrowserSmoke.js --workers=1` run passed **86
  desktop/mobile Chromium tests** on 12 September, including Visitor 2D/3D
  journeys, recorder export and existing operator regressions.
- Final review then reproduced a queued pre-resume orientation event bypassing
  the initial visibility reset. The timestamp-boundary correction passed its
  unit regression. On 14 September, **six targeted production-browser checks**
  passed against the final code, including the extended recorder export test,
  surface round trips and direct operator routes. Command:
  `node scripts/runBrowserSmoke.js e2e/recorder-continuity.pw.ts e2e/layout.pw.ts e2e/public-shell.pw.ts --grep "recorder exports|every surface round-trips|operator routes stay reachable" --workers=1`.
- The full 86-test browser suite was not rerun after that final narrow correction;
  separate offline/install suites were not rerun in this slice. Main project and
  full browser suites ran sequentially, without relaxed assertions or timeouts.
- Processor 0.5 / policy 0.4 deliberately change replay/eligibility semantics;
  raw capture and recording versions stay 0.2. No hardware timing, surveyed
  calibration, accuracy or obstacle-safety claim is implied by these tests.
- Work remains local for review. No commit, push, deployment, venue recompile or
  historical capture rewrite. Next bounded slice: matching forward-jump,
  ambiguity and floor-transition gates, still before live Visitor tracking.

### Phase 2 slice E verification — 14 September 2026

- All 11 initial route/floor regressions failed against the actual pre-change
  implementation with the prior continuity slice preserved. Follow-up regressions
  reproduced defects in the first implementation before correction: unrelated
  crossings sharing progress labels, same-time advances, stale/omitted runtime
  matches, disconnected corridor hops and over-rejection of straight subdivisions.
- Added **42 unit tests**. `npm run check` passed: lint, types, **906 tests across
  85 files**, all three unchanged venue hashes, artifact sync, synthetic reference
  replay, QR sheets and public production build. The existing large-chunk warning
  remains. No assertion or timeout was relaxed.
- **Eight targeted desktop/mobile Chromium checks passed** against the production
  operator build: recorder export, camera-preview return, verified check-in with
  standard/step-free routing, and shared-scene 2D/3D switching. Command:
  `node scripts/runBrowserSmoke.js e2e/visitor-map-views.pw.ts e2e/visitor-journey.pw.ts e2e/recorder-continuity.pw.ts --grep "2D and 3D use one scene|camera preview returns|a verified check-in drives|recorder exports" --workers=1`.
- The full browser and offline/install suites were not rerun in this core-only
  slice; their earlier results remain historical. Main project and browser suites
  ran sequentially. No Visitor presentation or device enrollment changed.
- The synthetic reference report gained five zero-valued rejection counters;
  its observation stream, accepted matches and runtime counts are unchanged.
  Processor 0.6 records changed semantics; policy/capture/recording stay 0.4/0.2/0.2.
- Previous local work is preserved. No commit, push, deployment, venue recompile,
  historical field artifact rewrite or automatic Visitor tracking was performed.
  The default progress cap and uncertainty band are software policy, not measured
  speed, clearance or localization accuracy. Explicit live reacquisition, freshness,
  whole-venue off-route evidence, verified connectors and physical pilots remain open.

### Phase 2 slice F verification — 15 September 2026

- Added **62 live-session tests**. The initial 13 failed because the session API
  was absent; they are feature-absence tests, not old replay bug reproductions.
  Six follow-up tests reproduced implementation defects before correction:
  pre-acquisition/overlapping strides, malformed stride input, stopped-session
  timer cleanup, calibration reporting success after route rejection, and timer
  cleanup after a consumer exception.
- `npm run check` passed: lint, types, **968 tests across 86 files**, unchanged
  venue hashes (386a43f4b609 / 9a9c9d37907c / 639ca9c4a7ae), artifact sync,
  reference replay, QR sheets and public production build. The existing
  large-chunk warning remains. No assertion or timeout was relaxed.
- **Eight targeted desktop/mobile Chromium tests passed** against the production
  operator build: recorder continuity export, camera-preview return, verified
  standard/step-free routing and shared-scene 2D/3D switching. Command:
  `node scripts/runBrowserSmoke.js e2e/visitor-map-views.pw.ts e2e/visitor-journey.pw.ts e2e/recorder-continuity.pw.ts --grep "2D and 3D use one scene|camera preview returns|a verified check-in drives|recorder exports" --workers=1`.
- Project and browser checks ran sequentially. Full browser and separate
  offline/install suites were not rerun; earlier results remain historical.
  The browser checks guard existing journeys, not a live session UI integration.
- The controller/watchdog are library-only. No sensor listener, camera access,
  Visitor progress or automatic recovery was enabled. Browser lifecycle ownership,
  validated calibration and real-device/mobility trials remain open. Synthetic
  motion/calibration inputs are not surveyed accuracy or physical-safety evidence.
- Prior local changes are preserved. No commit, push, deployment, venue compile,
  capture/report regeneration or evidence-version change was performed in slice F.
  Work is local for review; the next bounded slice is the operator-only integration
  harness described above and in [the session contract](localization/live-session.md).

### Browser-smoke repair and slice G1 verification — 15 September 2026

- Reproduced the two reported smoke failure families before changing production
  behavior: deterministic missing-camera rejection and an expanded directions
  panel intercepting the retry action. The four desktop/mobile regression cases
  failed against the existing code. A separate 320 px Cancel-button viewport
  assertion then reproduced horizontal clipping before its CSS correction.
- Camera geometry tests now use an explicit empty test stream. A separate
  missing-camera journey expects exactly its one known console error and verifies
  that returning preserves the instruction. Global console-error checks remain
  strict. Map recovery is in the visible directions scroll flow, with real hit
  testing and clicks at compact, expanded and 320 px sizes. No forced clicks,
  retries or longer timeouts were added.
- Added **26 unit tests**: 11 canonical package/route preparation tests and 15
  harness ownership/lifecycle tests. The initial missing factory was feature
  absence, not an old behavioral bug. A follow-up check caught a misleading
  "Not started" label after cancelling pending verification; it now says "Stopped".
- `npm run check` passed: lint, types, **994 tests across 88 files**, unchanged
  venue hashes (386a43f4b609 / 9a9c9d37907c / 639ca9c4a7ae), artifact sync,
  reference replay, QR sheets and public production build. The existing chunk-size
  warning remains. No venue, capture, report or evidence version was regenerated.
- Targeted production-browser checks passed for the six camera/recovery cases
  and the two operator diagnostic journeys. The latter use the real Asterion
  package and check expiry/reacquisition, no hardware permission requests,
  unchanged Visitor state, lifecycle cleanup and reachable 320 px controls.
  Narrow-screen recovery and diagnostic screenshots were visually inspected.
- The complete `npm run test:browser` passed with `CI=true` on this Windows host:
  **90 operator tests** (6.9 minutes), **12 public offline tests** (45.5 seconds),
  and **2 install/update-failure tests** (19.2 seconds), **104 total**, one worker,
  no skips or retries. Unit and browser gates ran sequentially. This is not a
  claim that the remote Linux GitHub job has been rerun; that remains to be done.
- `git diff --check` passed. Work remains local for review, with no commit, push
  or deployment. Qualified handset input and measured independent calibration
  remain open; no automatic Visitor movement or physical accuracy claim was added.

### Phase 2 slice G2 verification — 16 September 2026

- Added **46 unit tests**: 22 reducer tests, 12 permission-subscription tests and
  12 additional harness tests. Missing new modules initially produced feature-
  absence failures, not proof of defects in the existing replay pipeline.
  Follow-up tests reproduced five implementation defects before correction:
  raw readiness disappearing after startup disorder, accepting calibration behind
  consumed input, no first-sample deadline after calibration, copied acquisition
  tokens being accepted, and diagnostic heading surviving acquisition replacement.
- `npm run check` passed: lint, types, **1,040 tests across 90 files**, unchanged
  venue hashes (386a43f4b609 / 9a9c9d37907c / 639ca9c4a7ae), artifact sync,
  reference replay, QR sheets and public production build. The existing chunk-size
  warning remains. No venue, capture, recording, report or evidence version changed.
- The panel has no independent pose producer and never invokes calibrated motion
  forwarding. Software tests of that path use explicit synthetic declarations;
  neither those tests nor the browser permission fixtures establish physical
  device behavior, localization accuracy or safe automatic navigation.
- The complete `npm run test:browser` passed with `CI=true` on this Windows host:
  **94 operator tests** (6.1 minutes), **12 public offline tests** (37.4 seconds)
  and **2 install/update-failure tests** (19.1 seconds), **108 total**, one worker,
  no skips or retries. The operator suite includes six desktop/mobile harness
  journeys; the new opt-in cases cover paired/partial input, denial, cancelled
  late grants, Visitor isolation and real hit targets at 320 px. The fresh mobile
  screenshot was visually inspected. Project and browser gates ran sequentially.
- The public build-graph guard excludes both handset modules, and offline tests
  confirm a guessed operator hash exposes no diagnostic. `git diff --check`
  passed. No assertion, retry count or timeout was relaxed.
- Existing local work is preserved. Nothing was committed, pushed or deployed;
  the remote Linux GitHub job has not been rerun. The next boundary remains
  measured independent calibration and physical handset/venue validation.

### Live tracking and landmark directions — 17 September 2026

Implemented in the Visitor surface, after review of the current product:

- **Live tracking.** `src/navigation/liveTracker.ts` moves guidance from the
  phone's motion sensors as a route-constrained tracker: strides from the
  existing dead-reckoning integrator advance progress only while the
  gyro-relative direction of travel agrees with the corridor; uncertainty grows
  8% per metre and resets at every scan; storey changes are confirmed by a scan
  or by the visitor, never inferred; a walk off the route holds the marker and
  offers a scan. Four tiers (anchored, tracking, caution, frozen) are shown in
  the instruction banner by weight, with a reason-specific line and the actions
  that would help. `useLiveTracking` owns the consent-owned handset
  subscription, tilt pairing, stop/resume and re-anchoring on a new route.
  Documented in [visitor live tracking](localization/visitor-live-tracking.md).
  It is separate from the recorder, replay and evidence pipeline and is not an
  accuracy claim; no physical-handset validation has been done.
- **Landmark directions.** `src/engine/routeLandmarks.ts` rewrites the graph's
  instructions in the venue's own public destinations: turns at the room
  nearest the corner, stretches past the last room whose wall lies beside them,
  arrival on the side the door is on, judged from the corridor rather than the
  doorway hop. Applied in `calculateCompiledRoute`, so the worker and the
  fallback path agree. Nothing is invented; a place not beside the route is
  not named.
- **Gate.** 1,118 unit tests; 100 operator browser journeys including two new
  tracking journeys driven by a synthesised, wall-clock-driven walker that
  obeys the banner; 12 cold-offline and 2 install/update journeys unchanged.

### The camera as a window onto the same guidance — 17 September 2026

- **What changed.** `src/components/CameraPreview.jsx` no longer previews
  instructions with buttons of its own. It draws the route ahead on the floor
  of the camera image (`src/ar/floorProjection.ts`: a pinhole camera at
  chest height, facing a plan bearing, tilted by the pitch and roll the
  phone's gravity vector gives) from the same progress the map's marker uses,
  and its instruction card is the banner's copy. The facing is the tracker's
  direction of travel once walking has established it, else the visitor's word
  that they are looking along the corridor, else the route's own bearing -
  and the readiness panel names which (`src/ar/facingFrom.ts`). A compass is
  never consulted for it. On a browser that offers `immersive-ar`
  (`navigator.xr.isSessionSupported`, Android Chrome on ARCore hardware; no
  iOS in 2026) "Start AR" opens a session (`src/ar/arSession.ts`) that anchors
  chevrons to the world on `local-floor`, refines the floor by hit testing,
  and feeds the phone's own tracked movement to the tracker as metric
  displacement (`RouteTracker.displace`), with a DOM overlay carrying the
  instruction and a one-tap re-alignment.
- **What it says about itself.** "Not world-anchored" outside a session;
  "Anchored to your start point" inside one, because the world is lined up
  with the plan from an assumption about where the visitor stands, not from
  the building. Frozen now holds until a scan, for strides and poses alike.
- **What it is not.** No real handset has run the immersive session; the
  browser journeys stub the capability and prove the offer, the refusal and
  the flat overlay. The gravity-to-attitude signs in `attitudeFromGravity`
  follow the W3C device frame and want a check on a physical phone. Spoken
  guidance belongs to the journey rather than to a view: the same instruction
  is read aloud on the map and in the camera, and the mute choice survives
  switching between them.
- **Gate.** lint, tsc, 1,140 unit tests including the new floor projection,
  plan-world, pose-displacement and camera guidance suites; the visitor
  browser journeys on both projects, including a tracked walk seen through the
  camera in `e2e/live-tracking.pw.ts`.

### The model as a maquette on the page — 17 September 2026

- **What changed.** `src/map/venueScene.ts` draws the building's own shadow
  on the page beneath it (a `ShadowMaterial` ground that comes in with the
  tilt and sits under whatever is lowest in the stack), with soft-edged
  shadow maps and a normal bias instead of a deep depth bias. The floor stack
  opens and closes rather than cutting: every storey eases to its height and
  ghosting, and the lift and stair shafts and the route's climbs are re-laid
  each frame to wherever the floors are, so a route never detaches from the
  stop it climbs from; `data-camera-transition` stays `moving` until the
  floors have settled too. The walls in front of the marker thin out within a
  couple of metres of it (a world-sized window in the wall shader), so the
  marker and the floor just ahead of it are never behind a wall. The route's
  end is a destination tier of label - ink, always eligible, above every
  other - via `setDestination`.
- **What was wrong.** Stepping the walk-through onto "take the stairs" lost
  the marker: the displayed floor switched to where the stairs go while the
  marker stayed at the top. `positionShownOn` now draws it at whichever end
  of the run is on the floor being read.
- **What it is not.** The window through the walls and the ground shadow are
  presentation; they change nothing about where the guidance says the
  visitor is. The camera is orthographic and far away, so "walls near the
  camera" was never the problem - walls between the marker and the eye were.
- **Gate.** lint, tsc, the unit suite, and the map, journey and tracking
  browser journeys on both projects.

### The camera view reads the phone, not the route — 18 September 2026

- **What was wrong.** The camera view drew the route in a fixed place on the
  glass. Two things caused it and both were mine. The facing came from
  `facingFrom`, which fell back to the route's own bearing whenever live
  tracking was off - so the path was always dead ahead however the phone was
  pointed. The tilt came from `attitudeFromGravity(live ? gravity : null)`,
  and gravity only flowed while the tracking subscription ran, so with
  tracking off the pitch was a constant -18°. A fixed heading and a fixed
  tilt is a diagram, not a view of the floor. It also crashed on open:
  lucide's `Map` icon shadowed the global `Map` constructor, so `new Map()`
  in the draw loop threw and React unmounted the whole view.
- **Why the tests missed it.** `CameraPreview.heading.test.tsx` mocked
  `getContext` to null, so the draw loop returned before its first line. The
  suite has been rewritten around a canvas that answers and frames that are
  run by hand on a clock the test controls; it now asserts that a ribbon of
  floor points is painted, which is what the crash destroyed.
- **What changed.** The view owns an orientation feed of its own
  (`src/ar/orientationFeed.js`), running from the moment it opens whether or
  not anything is tracked, and asking iOS for permission through a button of
  its own. `src/ar/deviceAttitude.ts` rebuilds the W3C rotation matrix and
  reads the camera's pitch, roll and yaw out of it, which keeps the answers
  stable at beta = 90 - a phone held upright to look ahead, and exactly where
  the alpha/gamma decomposition is degenerate. `facingFrom` now takes that
  yaw and an anchor saying what its arbitrary zero was looking at: the
  visitor's word, or the route's own bearing, said plainly as an assumption.
  Turning the phone turns the drawn route by the same angle either way.
- **What else the view gained.** Labels floating in the world where the
  destination, the next corner, the stair and the nearby places are, with how
  far off they are (`src/ar/callouts.ts`); a plan in the corner turned the
  way the visitor faces (`src/ar/cameraMiniMap.js`); an arrow saying which way
  to turn when the route is further round than the camera can see; and a path
  that starts a metre or so ahead rather than under the visitor's feet, which
  is what made the old near end a slab of colour across the bottom.
- **What it is not.** The vertical field of view is a stated 55°, not a
  measurement - no browser reports a camera's true field of view, and the
  video is cropped to the screen besides. Nothing here has run on a physical
  handset, so the attitude signs and that field of view both want checking on
  one. Without an immersive session the zero of the yaw is still an
  assumption: face along the corridor and say so, and it is right; walk off
  without saying, and the route points the wrong way until you do.
- **Gate.** lint, tsc, 1,169 unit tests including new suites for the attitude
  maths, the facing rule and the world labels; 48 visitor browser journeys on
  both projects.
