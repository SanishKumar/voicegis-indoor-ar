# Known seams

Deliberately unfinished work, recorded so it is not rediscovered as a bug. Each
entry says what is incomplete, why it was left, and what finishing it involves.

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

## Derivation configuration is caller-supplied and unrecorded

`buildEvidenceReport(session, overrides)` accepts checkpoint tuning,
dead-reckoning tuning and route geometry that are applied to the derivation and
then not written down anywhere in the report. One capture can therefore report
different figures or map-matching counts while every result claims `ok`.

Verified on 2026-08-11 against the walk in `coordinateBounds.test.ts`: it reports
a median of 3.688 m with the authoritative tuning, and 8591.346 m — still `ok` —
with `strideLengthMeters` overridden to 1000.

The building-frame coordinate bound refuses only the far end of this. Tuning
extreme enough to make any derived estimate or map match non-numeric or leave
the frame now reports `invalid-localization-state` instead of a number, which
is why an override of 1e300 is refused. Any override that keeps the complete
derived state inside the frame still moves the figure silently.

Bounding the reported error itself was considered and rejected. A walk with
genuinely poor accuracy is still a real measurement, and refusing it would
suppress the results most worth publishing honestly. The fix belongs with the
sealed evidence artifact: the resolved configuration has to be fingerprinted
into the report, so a figure names the tuning that produced it.

## The capture frame bound is not yet a shared spatial-schema rule

Capture anchors and ground-truth marks use an axis-aligned local-metre frame
whose components are limited to -100 km..100 km. The compiler and VenuePackage
validator still require finite coordinates but do not yet enforce the same
bound. A package with geometry outside it could therefore compile and activate,
then be refused when its anchors are authored into a capture session.

Current venues are tens of metres across, so this does not affect shipped
packages. Before accepting georeferenced or unusually offset source geometry,
the coordinate-frame contract and its bound must move to the shared spatial
schema so compiler, package verification, runtime and capture agree.

## A ground-truth mark carries one timestamp for two different meanings

Capture chronology and immutability, deferred from Recorder Integrity v0.1.1,
closed on 2026-08-11. A capture clock that goes backwards is reported rather
than sorted away for samples, scans and lifecycle events alike; distinct
inertial samples must differ by at least `MIN_SAMPLE_INTERVAL_MS`; sequences
must run `0..n-1` so an event cannot be deleted without trace; a session has one
`session-start` at time zero and at most one terminal `session-end`; everything
a session claims about itself is copied out of the caller's options at
construction; each recorder input is read exactly once, by fixed index, and
optional fields are copied only when the caller actually owns them; and every
event leaving the recorder is a snapshot.

An earlier version of this entry claimed same-millisecond correctness was fully
solved. That overclaimed. `(timeMs, sequence, ordinal)` keys and exact
`observationIndex` scoring do carry capture order through derivation among
events the device stamps, and that part is sound. But a ground-truth mark
carries only one timestamp, and it means two different things: `timeMs` is when
the surveyor stood on the mark, while `sequence` is when the annotation was
written, which may be much later.

So when a resolved scan shares a mark's millisecond, the capture genuinely
cannot say which happened first, and the two readings are not close: the same
fixture scores 1.28 m if the mark preceded the reset and 88.197 m if it
followed. Those marks are now excluded as `ambiguous-anchor-reset-tie` rather
than ordered by annotation sequence, which is not evidence of when anything
occurred.

Capture Stream 0.3 is where this closes properly, by giving a mark separate
occurrence and recording timestamps. Until then the exclusion is conservative
and costs only marks that were never orderable.

Separately and optionally: no derived observation records which capture event
produced it in a form that survives outside the process. The key exists in
memory during derivation and is discarded. Nothing is presently wrong because of
this — it becomes worth doing when the sealed evidence artifact needs to show,
from the artifact alone, how each observation traces back to the stream.

The clock rule covers inertial samples, scans and lifecycle events, all of which
the device stamps when it records them. Only ground-truth marks are exempt,
because a floor mark is hand-annotated and often noted a moment after it was
stood on. This does place a requirement on the handset recorder: a scan must
carry the time it is recorded, so a decode that takes noticeable time cannot be
stamped with its acquisition instant and backdated behind samples already
written.

An earlier version of this file claimed the chronology holes could not alter
reported accuracy. That was wrong and was disproved by review: an interruption
was shown to move a published checkpoint error from 2.828 m to 0.776 m, and a
backdated scan moved a published error by reordering the anchor reset a mark was
scored against. Excluding ineligible checkpoints bounds *which* marks are
scored; it does not bound the correctness of the estimate they are scored
against.

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
