# Visitor operational-policy lifetime

Implemented locally, 30 September 2026. This is an expiry/recovery contract
for imported operational overlays, **not a live closure publication service**.

## Decisions use decision time

Every Visitor route request and synchronous preview evaluates the policy with
the current wall clock. `operationalEvaluatedAt` remains historical import
metadata only. The operator session diagnostic reproduces the accepted route
receipt's evaluation time; it does not authorize Visitor guidance.

The provider owns a frozen copy of each imported policy and gives every
replacement a new local revision. Pending results cannot cross that revision,
a cancelled request or a changed start. A result is checked again when the
worker resolves; a delayed timer is not permission to accept an expired result.
Wrong-package, malformed, future-dated and expired policies fail closed.

## Active-trip expiry

A bounded watchdog wakes at the next expiry or within one second. Foreground,
visibility and page restoration also recheck freshness. Progress actions and
camera/XR frames check synchronously before advancing or drawing a route.
React snapshot updates and graph resolution are not performed every frame.

The lease checks wall time and a monotonic deadline. A small wall-clock
correction cannot extend it; a material rollback or broken monotonic clock
invalidates it. Expiry/clock loss stay latched for that lease. This is **not** a
trusted clock, signature verification or anti-replay mechanism: a fresh page,
new import or misconfigured initial clock needs a future authenticated feed
and trusted freshness design.

When a requested or active trip loses its policy:

- Destination and accessibility choice remain saved.
- Old geometry/instructions are removed, camera media is released, and XR
  retires before counting or drawing its next pose frame. Recovery returns to
  the map with a focused “Directions paused” explanation and an exit.
- Preview progress is not converted into the visitor's current position.
- A scan may record location, but cannot refresh policy or resume the route.
- Removing an imported overlay does not mean previously closed paths opened.
  It remains an unavailable required policy until another valid import or a
  new venue session. Cancelling a trip cannot bypass the recovery requirement.

## Deliberate recovery

Once a replacement policy is current, the trip still waits for a **new** scan
or explicit current-start selection. A scan taken while policy was unavailable
is not reused automatically. A selection remains labelled as selected, not a
measured position. The new route begins at zero progress and uses the saved
destination/profile. An invalid scan or unknown selected node cannot qualify
the start. Becoming online or a future policy reaching its start time cannot
silently resume the trip.

If closures leave no compliant step-free route, the app preserves that trip
intent too. It does not silently substitute stairs. The explicit “Try the
fastest route” choice can now replan the saved destination under the same
current closure policy; dismissal cancels it.

Offline recovery explains that a cached venue map cannot confirm open paths.
Coming online does not fetch a policy in this implementation. The operator
import controls also show current policy failure instead of indefinitely
calling an earlier import active. Opt-in field reports record policy changes
and pauses only, not per-frame data or automatic uploads.

## Coverage and remaining backend boundary

Pure lease tests cover interval boundaries, clock faults, invalid policy and
immutable ownership. Provider tests cover delayed results, foreground return,
policy replacement/removal, cancellation, profile retention and reacquisition.
AR tests cover stale-start permission races and frame retirement before
displacement. Recovery UI tests cover focus, offline wording and explicit
location choices. `e2e/closure-recovery.pw.ts` uses the existing operator import
UI in a production build to exercise Visitor recovery and media cleanup at
desktop/mobile widths; it adds no Visitor test-only policy hook.

The public app currently uses authored venue restrictions without a live
policy feed. Authenticated publication, revision ordering, rollback/replay
prevention, delivery failures, policy-required venue configuration and trusted
freshness across reload/offline sessions are **not implemented by this slice**.
Expiry guards must not be advertised as a working live operations backend.
Real-device/browser lifecycle qualification also remains open.

## Local verification

- `npm run check`: lint, types, **1,577 tests in 126 files**, all
  venue/replay/print-sheet checks and the public build pass. The public static
  entry remains within budget: 431.4 KiB raw / 140.3 KiB gzip.
- The new closure browser flow passes on desktop and mobile: offline expiry,
  updated-policy reacquisition, camera release and an explicit fastest-route
  choice after step-free routing is blocked. Small-phone recovery was also
  inspected visually at 320 px.
- **52/52** targeted public-build browser cases pass for Visitor journeys,
  camera alignment, AR floor placement, offline use and deferred-view recovery.
- A pre-existing async lazy-import focus test now waits for the focus effect,
  retaining the same assertion. Browser recovery/focus assertions also pass.
- The full operator browser suite, hosted CI and real handsets were not
  requalified. The existing large deferred-Three chunk warning remains.
  All changes are local; nothing was committed, pushed or deployed.
