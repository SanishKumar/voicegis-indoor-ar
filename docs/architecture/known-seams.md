# Known seams

Deliberately unfinished work, recorded so it is not rediscovered as a bug. Each
entry says what is incomplete, why it was left, and what finishing it involves.

## Nothing dates a checkpoint manifest before the walk it governs

Eligibility used to be entirely self-declared: every rule deciding whether a
mark counted read a property the capture asserted after the fact, so a late mark
that came out badly could disappear from the denominator by being relabelled.

Evidence Artifact v0.1 closed most of that. Sealing takes a checkpoint manifest
that fixes each mark's id, surveyed position, floor and intended role before the
walk, and refuses a capture that contradicts it: a mark that was never
predeclared, a mark surveyed somewhere other than where it was declared, or a
checkpoint id used twice all stop the seal. The manifest is canonicalised and
hashed into the artifact, so relabelling a mark from `scored` to `diagnostic`
changes both the manifest hash and the artifact hash even though the walk is
byte-identical.

The manifest precommits every claim eligibility reads — the surveyed position
and floor, the survey method, the expected accuracy, and independence from
anchors — and sealing refuses a capture that disagrees with any of them. Those
claims live in the capture, which is written *after* the walk, so leaving them
unpinned meant a mark that came out badly could be rescued by upgrading its
declared survey or dropped by downgrading it. Manifest version 0.2.0.

A walk that falls short of its manifest now seals rather than being refused.
Refusing suppressed the failure outright: the walk that missed a predeclared
mark produced no artifact at all, so only the walks that went well left a
record. It seals with `manifest-not-satisfied` and a `missingScoredCount` that
says how far short it fell. A missing *diagnostic* mark blocks nothing, because
it never counted toward anything.

Duplicate checkpoint ids are refused at sealing rather than by the capture
schema. The rule is right either way, but adding it to Capture Stream 0.2.0
changed a released contract without the version saying so; it moves into the
schema at 0.3.0, alongside the separate occurrence and recording timestamps.

The roles are authoritative rather than advisory, which took a correction to get
right. A first version compared the manifest against the walk and then evaluated
the walk without it, so a mark declared `diagnostic` still sealed as `ok` with
the same median while the manifest beside it reported `scoredCount: 0`. The
binding now reaches evaluation: an undeclared mark is excluded as
`not-declared-scored`, and a predeclared scored mark that goes missing or fails
eligibility yields `manifest-not-satisfied` instead of a figure over whatever
survived.

What remains is provenance in time. The manifest is authored by the same person
who runs the walk, and nothing establishes that it existed *before* the capture
did. The hash proves which manifest produced a figure, not when it was written,
so a manifest edited after a disappointing walk and re-sealed is visible as a
different artifact but not as a later one. Closing that needs something outside
this repository — a countersignature, a published commitment, or simply a field
protocol that records the manifest hash somewhere durable before walking.

## A sealed artifact identifies the walk it describes

The artifact deliberately omits the walk itself: no inertial vectors, no
orientation samples, no scan payloads, no anchor positions. It is easy to read
that as anonymity, and it is not.

An artifact names the session id, the building id, the venue package hash, the
exact wall-clock instant the walk began, how many events it contained, and the
timestamps of any sampling gaps within it. Anyone holding one learns that a
particular walk happened in a particular building at a particular time, and
roughly how it went. That is appropriate for an accuracy report about a venue
the publisher chose to survey, and inappropriate for anything derived from a
walk someone else did not consent to publishing.

Nothing here needs changing yet, because nothing is published and no walk has
involved anyone but the author. Before an artifact is shown to a third party,
the identifying fields need a decision — a coarser start time, a session id that
is not reused across venues, or an explicit statement that artifacts are
venue-public. Signatures, which would add an author identity rather than remove
one, are a separate question again.

## A diagnostic report can still be tuned into any figure

`buildEvidenceReport(session, overrides)` accepts checkpoint tuning,
dead-reckoning tuning and route geometry, applies them to the derivation, and
claims `ok` regardless. Verified on 2026-08-11 against the walk in
`coordinateBounds.test.ts`: 3.688 m with the authoritative tuning, and
8591.346 m — still `ok` — with `strideLengthMeters` overridden to 1000.

Evidence Artifact v0.1 answers this by separating the paths rather than by
removing the overrides. `sealEvidenceArtifact(session, manifest)` takes no
tuning at all, resolves the authoritative configuration, and fingerprints the
values it actually used — both configurations in full, the thresholds around
them, and the policy as values rather than as a version — into a hash covering
the whole artifact. A figure that is evidence names the tuning that produced it;
a figure that names nothing is a diagnostic.

The overrides stay because tuning experiments are how the processor improves,
and a derivation that cannot be re-run with different values is hard to develop
against. The rule is not that overrides are forbidden but that nothing tuned is
evidence, and the type system now says so: only a sealed artifact carries a
content hash.

The localization filter was missed on the first pass. Its tuning was a shared
mutable object used as a constructor default rather than resolved through a
private authority, so every filter in the process shared one instance and it was
absent from the fingerprint entirely — the same capture could have produced a
different figure while the artifact recorded identical configuration. It is now
frozen, resolved per filter, and fingerprinted with the rest. The lesson is that
"the configuration" is every value that can move a number, not the ones that
happen to have a resolver.

The replay CLI is diagnostic and now says so. It calls `buildEvidenceReport`
without a manifest and writes an unsealed report, which names none of the inputs
that produced it; an earlier comment there described it as the evidential path,
which was the ambition rather than the output.

Bounding the reported error itself was considered and rejected. A walk with
genuinely poor accuracy is still a real measurement, and refusing it would
suppress the results most worth publishing honestly.

## Nothing in the repository is sealed

Sealing is no longer library-only: `npm run evidence -- seal` produces an
artifact and `npm run evidence -- verify` checks one, with `seal --check`
re-deriving it from its inputs. The two are different claims and the tool keeps
them apart — verifying recomputes the seal over an artifact held alone, while
`--check` asks whether those inputs still produce it under today's processor.

What is missing is any artifact under the quality gate. `npm run check` covers
compiler determinism, browser artifact sync and the replay report byte-for-byte,
but nothing sealed, so a processor change that moves a figure is caught only
where a test happens to assert that figure. The obvious fix — commit a sealed
artifact from the synthetic corridor walk and add `evidence:check` — was left
undone on purpose: a committed artifact carrying `status: ok` and a plausible
median error is exactly the object this project treats as quotable, and the
capture behind it is a constructed path with no device or building in it. The
replay report has the same hazard and manages it with a loud header, so the
precedent for labelling one exists; the judgement is whether a document whose
whole purpose is to look authoritative should ever be synthetic.

Deciding it either way is cheap. Doing nothing is the status quo, and the status
quo is that the seal is exercised by unit tests only.

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
indistinguishable from a shorter honest walk.

An earlier version of this paragraph said the sealed artifact closes that. It
does not, and the distinction matters. Sealing binds a figure to one exact
capture and makes any later change to either one detectable — but it seals
whatever it is given, so a stream edited *before* sealing is sealed in its
edited form and verifies perfectly. What the artifact provides is that the
window for undetectable editing ends at the seal; narrowing that window to
nothing is a field-protocol requirement (seal at the end of the walk, keep the
hash) rather than something the code can enforce.

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
