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
inertial samples must differ by at least `MIN_SAMPLE_INTERVAL_MS`; a session has
one `session-start` at time zero and at most one terminal `session-end`, and
evidence additionally requires that end to be present; anchor ids are unique, so
a duplicate cannot silently shadow the anchor a scan resolves to; a scan's
outcome and anchor id are checked against the anchors the capture carries, an
acquisition failure may claim neither a payload nor an anchor, and derivation
recomputes resets rather than trusting the stored label; everything a session
claims about itself is copied out of the caller's options at construction; and
every event leaving the recorder is a snapshot.

Authoring is strict rather than forgiving, which took several attempts to get
right. Every input the recorder reads — required or optional, a scalar, an array
element, or an orientation component — must be an own enumerable data property;
anything else raises `CaptureAuthoringError` where it is recorded.

Every softer variant of this rule turned out to be a bypass, which is why the
rule is now uniform:

- A scan payload supplied as an accessor became a valid `decode-failed` carrying
  nothing, suppressing a genuine reset and moving a figure from 1.288 m to
  2.449 m.
- An object with accessor indices — one the schema's own plain-array check would
  have rejected — was copied element by element into a real array, moving a
  median from 3.688 m to 22.688 m. The same hole existed one level up, in the
  anchors collection itself: 3.688 m to 18.688 m.
- Treating an unreadable *optional* field as absent fixed a prototype injecting
  `device.model`, then created the mirror-image bug: a scan declaring
  `permission-denied` through a getter had that failure discarded, resolved
  against the anchors instead, and published `ok` from a reset the device had
  reported it never made. Absent and malformed are now different answers.
- Judging an optional by truthiness rather than by its domain kept that same
  bypass alive: `failure: false`, `0`, `''` or `null` each produced a resolved
  scan naming an anchor, and `orientation: false`, `0` or `''` each became a
  valid `orientation: null`. Optionals are now checked against their exact
  domain.
- Reading a collection's `length` more than once let a Proxy answer differently
  each time — full length while the shape was checked, shorter while it was
  copied. Two anchors sharing a payload are an ambiguity that refuses to
  resolve; dropping one made the payload resolve cleanly and turned
  `insufficient-localization` into a publishable figure. Length is taken once
  from its own descriptor and used for everything after.

A recorder must never launder input the schema would refuse into a stream that
validates, and it must never quietly discard a claim the caller did make. A
refusal must also cost nothing: fields are snapshotted before a sequence is
allocated, because a refused call that had already taken one left the recorder
permanently unable to produce a contiguous stream.

### Where authoring stops trying

The line is drawn by *ownership*, not by mechanism:

- **The realm is trusted.** Standard intrinsics behave as the language says.
- **Caller-owned data shapes are not.** Objects and arrays handed to the
  recorder are checked, because ordinary code — and ordinary bugs — produce
  accessors, prototypes, hidden fields and odd lengths without anyone attacking
  anything.

Two things sit outside that line, and both are deliberate stopping points rather
than unfinished work.

**Replaced intrinsics.** Authoring trusts that `Array.prototype.push`,
`Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor` and
`Reflect.ownKeys` are what they claim to be, and it has to: a replaced `push`
rewrote a copied position from `[1, 9]` to `[101, 109]` and produced a session
with no validation issues, and a replaced `getPrototypeOf` defeats the
orientation shape rule the same way. Chasing this is an unbounded audit of every
intrinsic the code touches, and it buys nothing — anyone who can patch a builtin
is already running in the process and can call `recordScan` with whatever they
like.

Key checking is written without `Set`, spread or `for…of` anyway. All three
reach `Array.prototype[Symbol.iterator]`, and replacing it made the check pass
unconditionally, so an undeclared property was accepted and then silently
stripped. That exploit needs global prototype mutation exactly as replacing
`push` does, so it is the same trusted-realm case and not a separate one; the
counted loops are simply cheap, and cheap defence-in-depth is worth keeping even
on the trusted side of the line. It buys nothing that the boundary above does
not already concede.

**A Proxy that lies coherently** — one whose `ownKeys` and property descriptors
agree with each other while disagreeing with a hidden target. Authoring reads
each field once through its own descriptor, and every defect closed here was an
*incoherence*: a value that changed between two reads, or a shape the descriptors
themselves disclosed. A Proxy that answers consistently is not lying in any
detectable sense — its reflected view simply *is* the object it supplied. No
`JSON.parse` result or handset adapter produces one, and what actually closes
this class is the sealed evidence artifact, which hashes the stream as recorded.
Provenance answers "is this the capture that was walked"; no amount of
authoring-time reflection substitutes for it.

The hostile shapes that motivated the rules above — accessors, prototypes, hidden
and non-enumerable fields, changing lengths — all *can* arise from ordinary
object graphs, which is why they were worth closing and these two are not.

`Object.prototype` pollution falls on the trusted side but still must not break
honest recording. Authoring ignores the ambient builtin prototypes when deciding
whether a field was inherited, so a polluted realm cannot make honest captures
unrecordable, and snapshots copy only own keys so nothing ambient is carried into
a stream. Snapshot objects themselves are ordinary objects and still *inherit*
from a polluted `Object.prototype`; that is invisible to serialisation and to
validation, both of which read own keys only.

Sequence contiguity is worth stating precisely, because it is easy to overread.
Requiring `0..n-1` detects an event *dropped* from an otherwise untouched
recorder stream, and requiring a terminal `session-end` extends that to the tail,
which contiguity alone can never cover. Neither detects delete-and-renumber:
anyone willing to rewrite the remaining sequences produces a stream that is
indistinguishable from a shorter honest walk. Only the sealed evidence artifact,
which hashes the stream as recorded, can close that — so these rules protect
against accidental loss and casual edits, not against a determined author.

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
