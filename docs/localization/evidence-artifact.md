# Sealing and checking an evidence artifact

## Scope

This describes the tool, not a result. **No real walk has been captured yet.**
Every artifact this repository can currently produce is sealed from a synthetic
capture, and its error figures are properties of a constructed path rather than
of any device, venue, or building. Nothing here may be quoted as accuracy.

The artifact exists so that when a real number does arrive, it arrives naming
the inputs that produced it.

## What the artifact is

`sealEvidenceArtifact(session, manifest)` produces a deterministic document that
carries, under one SHA-256:

- the canonical hash of the capture, the venue package hash, and the hash of the
  predeclared checkpoint manifest;
- the processor, policy, capture-stream and recording versions;
- the exact resolved configuration and thresholds the figure was derived with —
  the tuning actually used, not the tuning intended;
- the policy as values rather than as a version number;
- the full evidence status, including the reasons any mark was excluded.

It records hashes rather than the data behind them: no inertial vectors, no
orientation samples, no scan payloads, no anchor positions.

It is not anonymous. See
[Known seams](../architecture/known-seams.md#a-sealed-artifact-identifies-the-walk-it-describes)
before showing one to anybody outside the project.

## Commands

```bash
npm run evidence -- seal <capture.json> <manifest.json> <artifact.json>
```

```bash
npm run evidence -- verify <artifact.json>
```

```bash
npm run evidence -- seal <capture.json> <manifest.json> <artifact.json> --check
```

## The two checks answer different questions

They are easy to confuse and are not interchangeable.

| Command        | Reads                        | Claim                                                                       |
| -------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `verify`       | the artifact alone           | The document is internally consistent and was sealed by this pipeline.       |
| `seal --check` | the artifact and its inputs  | The figure is still reproducible from those inputs with the code as it is today. |

`verify` is the weaker claim and the one that keeps working forever: an artifact
sealed by processor 0.1.0 will still verify long after 0.1.0 is gone, because
verifying only recomputes the seal over the bytes present.

`seal --check` is the claim that decays, and is supposed to. If the derivation
changes in a way that moves a number, `--check` fails against every artifact
sealed before the change. That failure is the tool working: the artifact records
`versions.processor`, and a figure produced by a different processor is a
different figure. Reseal deliberately, and expect the content hash to change.

Neither says who sealed anything. Authorship needs a signature and is
deliberately outside v0.1.

## A status other than `ok` is a result, not an error

`seal` exits successfully whenever a document was produced, including when the
walk produced no publishable figure — a walk that never localized, one
interrupted partway, one whose marks all failed eligibility, or one that fell
short of the checkpoints predeclared for it.

This is deliberate. Only `ok` carries a publishable figure, but treating the
others as command failures would rebuild the suppression the artifact exists to
prevent: run under a gate, the walks that went badly would break the build and
quietly never be committed, so only the flattering ones would survive. The
command prints the status, says out loud that there is no publishable figure,
and reports how many predeclared scored checkpoints went unwalked.

What does fail the command is a malformed input or a refusal to seal at all: a
capture that is not a valid capture session, a manifest written for another
venue, a checkpoint the walk recorded but never predeclared, a checkpoint id
recorded twice, or a mark whose surveyed claims disagree with the manifest.
Those are contradictions between the inputs, not outcomes of a walk.

## The manifest is authored before the walk

Sealing requires a checkpoint manifest fixing each mark's id, surveyed position,
floor, role, survey method, expected accuracy, and independence from anchors —
every claim eligibility reads. A capture is written after the walk, so leaving
any of them unpinned would let a mark that came out badly be rescued by
upgrading its declared survey, or dropped by downgrading it.

Nothing in this repository establishes that a manifest existed *before* the
capture it governs. The hash proves which manifest produced a figure, not when
it was written. Closing that needs a field protocol, not code — see
[Known seams](../architecture/known-seams.md#nothing-dates-a-checkpoint-manifest-before-the-walk-it-governs).

## Nothing in this repository is sealed

There is no committed artifact and no `evidence:check` in the quality gate,
because there is no real capture to seal and a committed synthetic one would be
a file that looks like evidence, carries a plausible median error, and can be
quoted by anyone who finds it.

The cost of that choice is that sealing is covered by unit tests rather than by
a byte-for-byte gate, so a processor change that moves a number is caught only
where a test asserts the number. See
[Known seams](../architecture/known-seams.md#nothing-in-the-repository-is-sealed).
