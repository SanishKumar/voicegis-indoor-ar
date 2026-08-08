# Known seams

## Capture chronology and immutability are not yet enforced

Deferred from Recorder Integrity v0.1.1, which hardened only the evaluation
boundary. Three known holes remain in `captureStream.ts` and `recorder.ts`:

- A sensor timestamp that goes backwards is hidden by sorting rather than
  reported, so a device with a regressing clock produces a plausible-looking
  stream.
- `buildSession` copies the events array but not the event objects, so a caller
  holding a reference can mutate a session that is described as immutable.
- Capture order among events sharing a millisecond is preserved in the stored
  stream but not fully carried through derivation.

None of these can currently alter reported accuracy, because dependent and
unalignable checkpoints are excluded before the evaluator sees them. They can
still make a stored walk misleading, so they must close before field capture.

## Inertial integration ignores interruptions

`DeadReckoningIntegrator.push` integrates yaw rate over the gap since the last
sample. When a session is backgrounded and resumed, the first resumed sample is
integrated across the entire missing interval and invents a heading change that
never happened. Lifecycle events are recorded but not consumed.

Deferred to the interruption-recovery slice. Until then, any walk containing a
`backgrounded` lifecycle event should be treated as heading-unreliable after
that point.

## Gyroscope axis assumes a flat handset

`reduceImuEvent` takes `gyroscope[2]` as the yaw rate, which is only the world
vertical when the phone is held flat. Held upright — the natural navigation
posture — the vertical axis is a different component, so heading drift will be
wrong in the field.

The agreed fix is orientation-aware projection of the gyroscope vector onto
world vertical, not a flat-phone requirement. The capture stream already records
the sensor API, angular-rate units, and coordinate frame needed to do this
correctly; only the projection maths is outstanding.

Deliberately unfinished work, recorded so it is not rediscovered as a bug. Each
entry says what is incomplete, why it was left, and what finishing it involves.

## Collapsed map labels are computed but not drawn

`resolveCartographicLabels` in `src/engine/floorplanCartography.ts` returns two
lists: `placed` labels that earned drawn text, and `collapsed` candidates that
did not. Collapsing exists so a feature is never silently dropped from the plan
— reference indoor maps keep an unlabelled point as a dot rather than deleting
it.

`FloorplanViewer` currently consumes only `placed`. The `collapsed` list is
produced and discarded, so a label that loses its space still disappears from
the map entirely. The engine behaviour is correct and covered by tests; the
renderer has simply not been wired to it.

Left unfinished on 2026-08-07 when cartography work stopped in favour of proving
localization in a real building. Finishing it means rendering a small
category-coloured dot at each collapsed candidate's anchor, and making those
dots hit-testable so they can be tapped like any other point of interest.

## Localization anchors are surveyed by hand

`buildings/*/source/building.json` carries anchor positions and headings that
were authored, not measured. Before an accuracy report from a real venue means
anything, its anchors must come from a tape measure against two walls, and the
report must state how they were surveyed. A positioning error measured against
an invented anchor measures nothing.

## Wall topology and cartographic theme are display derivations

`src/engine/wallTopology.ts` and `src/engine/cartographicTheme.ts` derive walls
and colour at render time. They are deliberately outside the compiled
VenuePackage, so venue hashes do not change when cartography changes. Anything
that needs walls to be verifiable — occlusion baked into a package, or a
published mesh — would have to move that derivation into the compiler and accept
rehashing every venue.
