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
interrupted IMU continuity/reset semantics; return to that continuity work after
the presentation slice is reviewed. A future raw
calibration/pose event, surveyed alignment and physical-device timing validation
are still required before accuracy reporting or automatic Visitor progress.

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

**Priority update — implemented locally for review before returning to IMU
continuity.** The Visitor now starts in a true orthographic 2D plan and tilts
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

Phase 1 was completed and is now committed at `94ccc91`. Phase 2 slices A, B and C are implemented locally for review; the rest of Phase 2 and phases 3–8 remain planned. No push or deployment was performed. In Phase 1, the pre-existing operator welcome-overlay edit in `src/index.css` was preserved unchanged; new visitor styles live in `src/components/visitorJourney.css`.

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
