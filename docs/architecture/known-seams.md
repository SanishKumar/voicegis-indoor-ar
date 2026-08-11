# Known seams

Deliberately unfinished work, recorded so it is not rediscovered as a bug. Each
entry says what is incomplete, why it was left, and what finishing it involves.

## Extreme finite coordinates can reduce to an infinite error

Positions are validated as finite numbers, but the error between two of them is
a subtraction followed by `Math.hypot`. Two finite coordinates far enough apart
overflow: the difference between `1e308` and `-1e308` is already `Infinity`, so
a checkpoint error can be non-finite even though every input passed validation.

Found during descriptor-safety review on 2026-08-11 and deliberately left out of
that slice. It needs its own fail-closed correction — bounding coordinates to a
plausible building extent, and refusing a non-finite error rather than carrying
it into a percentile — and that should land before sealed-artifact hashing, since
hashing a report containing `Infinity` would seal a meaningless number.

## Checkpoint eligibility is self-declared

Every rule that decides whether a surveyed mark counts reads a property the
capture itself asserts: whether the mark is independent of anchors, how it was
surveyed, and how accurate that survey was. All three are declared after the
walk, by whoever writes the capture.

That means a mark can disappear from the denominator by being labelled
`estimated`, marked dependent, or given an expected accuracy outside policy —
and a late mark that would have failed is exactly the one most tempting to
relabel. The eligibility rules are sound; what is missing is that nothing binds
them to a decision made *before* the walk.

Real field evidence will need a predeclared checkpoint and evaluation manifest:
the marks, their surveyed positions, and their intended role fixed and hashed
before capture begins, so the denominator is chosen in advance rather than
discovered afterwards. That belongs with the sealed evidence artifact and the
field protocol, not with the evaluation code.

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

An earlier version of this file claimed these could not alter reported accuracy.
That was wrong and was disproved by review: an interruption was shown to move a
published checkpoint error from 2.828 m to 0.776 m. Excluding ineligible
checkpoints bounds *which* marks are scored; it does not bound the correctness
of the estimate they are scored against. Treat any figure produced before these
close as provisional.

## Inertial integration ignores interruptions

`DeadReckoningIntegrator.push` integrates yaw rate over the gap since the last
sample. When a session is backgrounded and resumed, the first resumed sample is
integrated across the entire missing interval and invents a heading change that
never happened. Lifecycle events are recorded but not consumed.

Deferred to the interruption-recovery slice. Until then, any walk containing a
`backgrounded` lifecycle event should be treated as heading-unreliable after
that point, and **its accuracy figures must not be published** — this is the
defect that was shown to move a checkpoint error from 2.828 m to 0.776 m.

## Gyroscope axis assumes a flat handset

`reduceImuEvent` takes `gyroscope[2]` as the yaw rate, which is only the world
vertical when the phone is held flat. Held upright — the natural navigation
posture — the vertical axis is a different component, so heading drift will be
wrong in the field.

The agreed fix is orientation-aware projection of the gyroscope vector onto
world vertical, not a flat-phone requirement. The capture stream already records
the sensor API, angular-rate units, and coordinate frame needed to do this
correctly; only the projection maths is outstanding.

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
