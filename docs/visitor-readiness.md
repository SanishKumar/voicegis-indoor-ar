# Visitor readiness and remaining work

Current software checkpoint: 3 October 2026. Visitor scope first. This
document describes the implemented software at this checkpoint, not a claim
that it has been deployed or qualified on physical devices. Earlier
entries in the experience plan are historical slice reports.

## Implemented, with automated coverage

- Verified venue packages, public destination search, QR check-in and
  deterministic standard/step-free multi-floor routing, including policy
  receipts and fail-closed exclusions.
- One journey shared by the 2D plan, 3D model and camera view. Inspecting or
  previewing the route is separate from measured physical progress. View
  focus, zoom, bearing and graphics choice survive a camera-view round trip
  and are scoped to the venue package hash.
- Opt-in motion tracking, uncertainty/caution/hold states, deliberate floor
  transition confirmation, written and spoken guidance, and recovery through
  a new check-in. Motion and XR displacement cannot own progress together.
- A shared orientation feed before scanning; approximate heading from a
  physically scanned sign can support map walking and camera direction.
  A payload-only link supplies position, not sign-derived direction.
- Experimental WebXR guidance with explicit surface qualification and floor
  confirmation, missing-heading handling, pose-jump/loss guards, reachable
  route/venue matching, and bounded walking-based direction refinement.
- Plain camera guidance follows device rotation/tilt but is **an estimated
  overlay**, not a measured world floor. It assumes camera height/FOV. It
  must not be judged as the immersive AR placement feature.
- Verified offline installation/cold reload after an online installation,
  project-subfolder delivery, view/context failure recovery, deferred map and
  camera modules, a public startup-JavaScript budget, and opt-in in-memory
  field reports. No report is uploaded automatically.
- Activation reverifies or repairs the current worker's exact cache bytes
  before retiring earlier release caches. Failed verification retains earlier
  bytes, while the current worker still activates and claims clients; this is
  not automatic worker rollback. The offline-worker unit file passes 15 cases,
  including eight activation cases. See [deployment semantics](deployment.md).
- Manual publication depends on the shared Quality workflow, including the
  full production browser command. Validation and the Pages build check out
  the same selected commit. Failed, cancelled or skipped quality checks block
  the publication build. See [the publication gate](deployment.md#publishing-to-github-pages).
- Visitor map graphics modes: Automatic, Full detail and Low detail. Low
  detail caps DPR at 1 and disables shadows, without simplifying route,
  label or location geometry. Automatic selection uses conservative optional
  device hints and sustained drawn-frame feedback, not idle time. See
  [performance policy and coverage](visitor-performance.md).
- Imported closure policy is evaluated at decision time, expires during an
  active trip, rejects stale worker/AR work and preserves destination/profile
  while waiting for updated policy and a newly confirmed start. Offline
  recovery never treats unavailable closure information as an all-clear. See
  [policy lifetime and backend limits](operational-policy-lifetime.md).

- Authored route-graphic clearance: continuous width checks against space
  boundaries and used portal openings, profile/restriction consistency, and
  exact glyph checks at corners. Width failures keep written guidance while
  withholding route graphics; inconsistent centerlines reject the route.
  Ordinary camera footprints are projected in metres, but their floor/FOV
  remain estimates. See [the contract and limits](route-graphic-clearance.md).

- Search exposes the full public match set with incremental paging and
  query/category recovery. Authored destination details and explicit
  preview/proximity/confirmed-arrival states are distinct across map, camera
  facts and spoken guidance. Journey/search
  text scales, short-screen panels scroll, and keyboard dismissal restores
  focus. See [interaction coverage and limits](visitor-interaction-accessibility.md).

- A venue of several buildings: a presentational site (grounds, buildings,
  what stands on them) round routable outdoor walks, an outside view that
  becomes rooms on coming in, and a view that opens where a check-in puts the
  visitor. Rooms in every venue are furnished by what they are for, clear of
  every door, pin and routable line. See
  [the models](design-system.md#the-models).
- Written directions name a turn for where it leads, and every trip a venue
  can give is read by test: from each public place and each check-in sign to
  each public place, fastest and step-free, 7,238 trips over the four bundled
  venues, for a missing route, a route that cannot be drawn, a turn back and a
  repeated sentence. `npm run directions:audit -- <venue>` lists them for one
  venue. A sign starts its routes in the space it hangs in, never on a doorway.
- A first visit by a sign's link needs only a destination; a visitor on the
  wrong map can choose the place from the first screen; and a place says which
  building it is in.

These are implementation/automated-test results. They do not establish
real-building positioning accuracy, camera alignment, usability or reliable
guidance for every handset. All bundled venues remain synthetic.

## Next software work, not dependent on a new phone report

### 1. Live operational-policy publication and delivery

The bounded imported-policy expiry/recovery slice above is implemented.
It does not authenticate or fetch closures, order externally published
revisions, or establish a trusted clock across new sessions. A live feed needs
those contracts plus rollback protection, delivery-failure handling and a
policy-required venue configuration. Those foundations can be developed
locally; choosing/provisioning a hosted backend needs separate authorization.

The current public build has no production live closure publication service.
Authenticated publication, revision delivery and a visitor feed are separate
backend work; imported policy support must not be advertised as live updates.

### 2. Extend authored clearance toward surveyed traversability

The bounded graphic-envelope slice is implemented. Real traversability still
needs surveyed constraints: physical mobility envelopes and turning space,
doors, obstructions, slope/level changes and uncertainty in map registration.
Those are not inferred from illustrative furniture or the 0.70 m display width.

### 3. Continue visitor cartography, interaction and accessibility polish

The bounded search/arrival/reflow slice above is implemented. Continue map
label/cartography work, authored entrance context and floor-change instructions.
Qualify screen-reader announcements and expand large-text, high-contrast and
reduced-motion journeys across actual platforms and software keyboards. Offer
venue-specific help only where published contact information exists. Passing
touch-target tests is not proof of an excellent overall user experience.

### 4. Release and offline-update safeguards

Add release checks for the supported capability matrix, offline update and
rollback behavior, current privacy/retention wording, and explicit diagnostic
sharing consent. Keep software/device support claims tied to demonstrated
results. Repository/deployment settings changes need separate authorization;
they are not implied by local implementation work.

The waiting-cache retirement guard is implemented. Activation reverifies the
current release and repairs missing or corrupt entries only from bytes matching
its build revisions. If completeness cannot be established, earlier caches are
retained and current availability stays false. The current worker still
activates and claims clients: retaining earlier bytes does not restore the
previous active worker. Eight deterministic activation cases cover the guard
within the offline-worker unit file's 15 passing cases.

The publication gate now reruns code and browser checks for the selected
commit before building its Pages artifact. The local reusable Quality workflow
and every checkout use that revision, so a later branch update cannot change
what is built. This remains a manually started publication workflow.

The public lifecycle browser run now covers changed JavaScript bootstrap URLs,
several concurrent tabs, cold-offline upgrade and operational rollback by
republishing an earlier complete release fixture. Waiting-cache eviction also
covers retained earlier bytes, honest unavailability, rejected wrong repair
bytes and successful exact-byte repair. These use the real production app with
synthetic versioned bootstraps, not two separately built product versions.
Deployment recovery on the chosen host, other browsers, and the capability and
privacy checks above remain separate release work.

The complete 162-case operator suite was measured with CI's one-worker settings:
14.6 minutes for a green run, after an initial 15.8-minute review run exposed
narrow-screen defects. The suite has since grown with the campus cases, which
draw a larger scene; the figure for the current suite is whatever the latest
hosted Quality run reports, and a run that nears the budget is a reason to
look at the slowest cases, not to raise it without looking.

Each Playwright invocation retains a 20-minute budget and its enclosing job a
30-minute limit. As of 6 October, desktop, mobile and offline checks run as three
independent CI jobs. The existing **Browser smoke** check requires all three to
succeed, including when a job is cancelled or skipped. Per-test limits,
assertions and zero retries are unchanged. Hosted CI performance remains
independently observable; local timing is not a guaranteed duration on GitHub's
runners.

### 5. Sign inventory and venue-pilot tooling

Build an inventory/change report that identifies signs affected by anchor
identity, mounting-direction, placement or venue changes, and produces a
replacement/checklist pack. Unrelated source changes should not require
reprinting every sign. The software can be prepared locally; measuring and
placing signs correctly is a later physical-venue task.

## Substantial features still unimplemented

- **Environment-depth occlusion:** hide appropriately placed AR guidance
  behind real objects only where capability and depth quality support it;
  degrade honestly where they do not.
- **Dynamic obstacle detection and avoidance:** needs observed obstacles plus
  a validated local traversability/clearance model, restrictions, mobility
  constraints and conservative uncertainty handling. Bending the displayed
  line alone is not avoidance and could imply an unsafe path.
- **Surveyed visual-marker pose:** the approximate sign-heading implementation
  is not a calibrated corner-based camera-pose solver. Survey metadata,
  camera-model qualification, competing-pose checks and synchronized
  sensor/XR-frame transfer remain separate work.
- **Sloped-floor/ramp AR placement:** current confirmed-floor placement is
  level-floor only. A horizontal surface can be a table; confirmation is not
  automatic semantic floor recognition.

These are engineering/design tasks, not completed features merely awaiting
your test. Depth/avoidance and calibrated pose need hardware and real-venue
validation before any product claim, even if their foundations are built now.

## Separate physical-validation gates

Phone reports and a venue matching the loaded map are still needed to measure
stride detection/scale, heading continuity, floor-hit stability, walking
refinement, pose loss/recovery, alignment and sustained GPU/battery behavior.
Field thresholds are provisional. A different corridor cannot validate the
synthetic venue's route or clearances. These gates remain open, but do not
prevent the remaining software work above from progressing.
