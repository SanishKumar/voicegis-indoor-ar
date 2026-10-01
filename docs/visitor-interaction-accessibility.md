# Visitor search, destination and accessible reflow

This is a bounded Visitor-only interaction slice, not an overall usability or
accessibility certification. It does not change localization, AR registration,
route selection or the operational-policy recovery rules.

## Search recovery and complete results

The search engine's default ten-result limit is no longer mistaken for the
total number of destinations. Search asks for the full public match set and
shows it ten at a time. The live summary states the total and displayed count.
“Show more” focuses the first newly revealed result, while route previews are
calculated only for the displayed matches.

Category mismatch offers “Search all categories” without discarding the query.
An unmatched query can be cleared or all destinations browsed. Clear controls
return focus to the input; neither searching nor pressing Enter in that input
starts a route. Details and Route remain separate, explicit actions.

Results are a named list with floor/accessibility metadata. A nested place
dialog retains the query on return. Dismissal restores the search trigger,
leaves the last check-in and route preference unchanged, and makes the closed
drawer inert. A newly requested route owns focus instead of the old drawer.

## Arrival means confirmation, not preview completion

- At the end of a preview: “End of route,” with an explicit statement that
  arrival is not confirmed.
- When live tracking reports its arrival radius: “Near destination,” with a
  request to check the destination sign.
- Only after the visitor explicitly confirms: “Arrival confirmed.” Done ends
  the trip and restores search focus.

The map, plain camera, immersive camera facts and spoken guidance share this
arrival distinction. A preview no longer produces “You are here” in the camera.
The AR proximity prompt asks for a destination-sign check rather than declaring
arrival. Spoken milestones have separate semantic keys so proximity and explicit
confirmation are announced once each even when the destination name repeats;
ordinary metre-by-metre countdown changes are still not repeated.

Destination details expose available authored floor, space and useful
description text. Duplicate derived descriptions are suppressed. No entrance,
door number, contact, hours or physical accessibility measurement is invented.
Step-list buttons are named “Preview step”; inspecting them still stops the
live progress source and does not move the physical checkpoint.

## Layout and keyboard behavior

Journey typography scales with the root text size. Destination and start
labels wrap instead of being single-line ellipses. The instruction banner's
actual height bounds the trip sheet; one scroll owner contains explanations,
actions and the full step list. Keyboard focus can reveal lower controls on
short screens, including policy recovery. The narrow-phone voice control is
at least 44 px, and text actions retain that minimum height.

At normal narrow-phone heights, a 172 px map band survives the operator dock
as well as the public shell. The collapsed sheet keeps its primary action
above the fold. Recovery cards and focus in preceding controls restore normal
scroll flow so the sticky footer cannot cover a focused Change, profile or
reload action. Real Tab traversal covers the start, profile and navigation
controls without scripted scroll assistance.

An unusually long instruction banner is also keyboard/touch scrollable and
bounded so it cannot consume the entire screen. A new instruction resets its
scroll position, but resizing or another stride does not interrupt reading.
The pre-route shell can scroll rather than letting enlarged header text
collapse the map/search area. End-route focus restoration permits native
scrolling so the search trigger is visible after that layout changes.
Empty-result recovery also permits native scrolling to reveal the newly
focused input when the whole enlarged search dialog has scrolled.

Search uses scalable typography and whole-dialog scrolling on short screens.
System high-contrast mode retains focus and selected-state outlines. Existing
reduced-motion handling remains in place. Large text necessarily gives the
written instructions more room and reduces the visible map area; it is not a
promise that every map overlay fits simultaneously at every zoom level.

On narrow screens, the map graphics chooser puts its three 44 px options in
one row. The vertical version's last option could otherwise disappear beneath
the directions sheet. This keeps graphics selection in the map band without
raising it above safety/recovery guidance.

## Evidence and limits

Focused tests cover search totals/paging/recovery, authored destination data,
explicit confirmation, preserved intent and focus, and banner resize cleanup.
Production-browser cases exercise 320 px layouts, 200% root text at 320×568,
short landscape, real Tab traversal, system high contrast, nested dialog
return and arrival/search focus recovery.

Slice verification on 1 October 2026, before the full-suite release review:

- `npm run check`: lint, types, 1,629 unit tests in 131 files, unchanged
  venue/replay/QR artifacts and the public build pass. Public startup
  JavaScript is 444.1 KiB raw / 144.9 KiB gzip, within its 500 / 170 KiB limits.
- 108/108 public production-browser cases pass across both screen sizes in
  visitor accessibility, search, journeys, map views/graphics, route clearance,
  deferred-view recovery, offline, camera alignment, AR floor placement and
  live tracking.
- 20/20 additional public keyboard/onboarding, narrow-camera and header
  cases pass. The delayed-routing case blocks service workers only in that
  test context so precaching cannot bypass its artificial download gate;
  focus, cancellation and late-result rejection assertions are retained.
- 6/6 closure-expiry/recovery cases pass using the existing operator import
  UI to supply policy. These exercise Visitor recovery, not a new live feed.

That checkpoint covered 134 distinct targeted browser cases with no retries
or skips, not the entire operator suite or hosted CI. The subsequent full-suite
timing, final focus fix and affected-suite revalidation are recorded in
[the release-review checkpoint](visitor-experience-plan.md#release-review-and-pre-push-verification--1-october-2026).
The existing deferred Three.js large-chunk warning remains.

These are Chromium software checks at desktop and mobile viewport sizes.
Actual Android/iOS text settings, TalkBack/VoiceOver announcements, switch
input, software-keyboard resize behavior and real-venue usability still need
qualification. There is no claim of WCAG conformance or parity with major map
products. Map cartography, measured entrance information, richer floor-change
context and authored venue-help contacts remain separate follow-up work.
