# Operator checkpoint and handset diagnostic

Phase 2 slices G1/G2, 15–16 September 2026. This exercises
[the live-session controller](live-session.md) with verified checkpoint tests
and separately opt-in handset input. It does not supply measured travel-heading
calibration or enable automatic Visitor navigation.

## Try it

1. Run the operator build (`npm run dev` or `npm run build:operator` followed by
   `npm run preview`). Plan a route in **Visitor view**.
2. Open **Record** and scroll to **Checkpoint session**. The recorder above it
   remains a separate tool; starting this diagnostic does not start a recording.
3. Choose **Start checkpoint diagnostic**. Package integrity and the selected
   route's current profile/closure policy are checked before creating a session.
4. Optionally choose **Enable motion diagnostics** in a secure, foreground
   browser. Motion and orientation permissions are requested together where
   required. Wait for the result before testing a checkpoint; **Disable motion
   diagnostics** also cancels pending enrollment. Starting the diagnostic alone
   requests neither permission.
5. Enter a QR payload from that package and choose **Test checkpoint / reacquire**.
   For the synthetic Asterion route from the L2 east check-in to Outpatient
   Pharmacy, use `voicegis://asterion/l2/east`.
6. A resolved checkpoint remains **Guidance frozen**, with independent heading
   unavailable. With no qualified motion, it expires after the session's default
   1,500 ms deadline. The 250 ms diagnostic publisher makes that expiry visible.
   Complete paired samples and rejected input are diagnostic counts, not
   qualified movement. Raw input may continue to update after session expiry;
   it cannot renew the guidance lease or turn its frozen state into tracking.
7. Test the checkpoint again to explicitly reacquire. This resets cached tilt,
   unfinished motion and input counts. Enabling motion also replaces acquisition,
   so enable first, then test the checkpoint. **Stop diagnostic** retires
   the session. Backgrounding pauses it; returning requires another explicit
   start, opt-in and checkpoint. Returning to Visitor leaves its instruction, route
   facts and last check-in unchanged.

Typing an authored payload is not a physical scan, consent to sensor capture,
localization accuracy evidence, or confirmation that a printed sign exists.
Occurrence time here is the manual diagnostic action's `performance.now()`.
No camera, independent calibration, recording export or evidence artifact is
produced by this panel. Sensor listeners exist only after the separate opt-in.
Samples and counts stay in memory; no position or progress is passed to Visitor.
For a phone, use the project's HTTPS development setup (`npm run dev:mobile`);
browser capability and permission still do not prove usable sensor delivery.

## Ownership boundary

`prepareDiagnosticSession` snapshots inputs before the asynchronous SHA-256
check, verifies the package contract, and recalculates the route from canonical
graph data under the supplied current policy. Stale path/profile/closure/package
bindings fail closed. Display-node copies are not trusted for geometry.

Horizontal route and checkpoint positions cross the plan/filter reflection once.
Floor elevations come from the package. Segment lengths use exact horizontal
geometry; connector distances retain gaps without inventing a horizontal segment
across floors. Authored marker orientation never supplies travel calibration.
The harness accepts the operator's existing deterministic closure evaluation
snapshot; it does not refresh closures from a service or verify field conditions.

The component owns one session, watchdog and optional handset subscription.
Stop, unmount, a changed package, route, profile or closure policy retire it.
Generation checks prevent late hash
results from enrolling after cancellation or a changed owner. Hidden/pagehide
events interrupt the session and dispose the watchdog and sensor listeners;
foregrounding does not automatically resume them. Late permission grants and
permission-query results cannot enroll a cancelled owner. Exposed permission
revocations detach listeners. Unsupported permission queries do not imply a
grant; sample and freshness checks remain necessary. No session survives leaving
Record or a reload.

The [handset input contract](live-handset-input.md) specifies occurrence clocks,
paired-sample refusal, software freshness limits and integrator reset boundaries.
Its calibrated forwarding path is exercised only with synthetic declarations in
unit tests. The panel has no independent pose producer and cannot call that path.

The UI, preparation and live handset modules are forbidden in the public build
graph, including its offline cache. A guessed `#/recorder` hash does not expose
the diagnostic.

## Verification and next boundary

The factory has 11 synthetic tests; the UI has 27 tests using the real session
with a small synthetic preparation substitute. The input reducer and subscription
have 22 and 12 tests respectively. Production-browser tests cover the real
verified Asterion package, refusal/reacquisition/expiry, lifecycle, Visitor-state
isolation, no permission requests before opt-in, controlled denial/late grants,
paired/partial input and 320 px controls.
The public offline test checks that the panel is absent. See the visitor plan
for complete gate results. These are software checks, not physical-device trials.

Next: obtain a valid independently measured travel-heading source and physical
handset timing/mobility data before qualifying live observations. Calibration
remains explicitly unavailable in this panel.
Do not manufacture calibrated heading from route geometry, a compass or a QR's
authored orientation. Whole-venue off-route evidence, verified connectors,
real-device/mobility trials and predeclared pilot thresholds remain prerequisites
for public automatic progress. Replay/evidence versions and artifacts are unchanged.
