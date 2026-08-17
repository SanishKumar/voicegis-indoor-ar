# Recording a walk on a phone

## Why this needs HTTPS

Safari and Chrome gate the motion and orientation sensors behind a secure
context. `localhost` is the only insecure origin they treat as secure, so a
phone loading `http://192.168.x.x:3000` is handed **no sensors at all**, without
an error. iOS additionally refuses to show the motion permission prompt outside
a secure context.

That is why the recorder looks broken on a phone over plain HTTP: it is not
broken, it is being given nothing.

## Run it

```bash
npm run dev:mobile
```

This serves HTTPS on every network interface and prints two URLs. Use the
**Network** one on the phone:

```text
➜  Local:   https://localhost:3000/
➜  Network: https://192.168.1.6:3000/
```

The certificate is self-signed, so the phone shows a security warning the first
time. Accept it — on iOS that is *Show Details → visit this website*. Both
devices must be on the same network, and a firewall prompt may appear the first
time on Windows.

Then open `#/recorder` and press **Start**.

## Reading the page

The banner under the button is the only thing that matters at first:

| Banner                         | Meaning                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| **Receiving N samples/sec**    | Working. A phone should show roughly 30–60.                       |
| **Nothing is being recorded**  | No usable samples. On a desktop this is expected and permanent.   |
| **Delivery has stopped**       | Samples were arriving and stopped — usually a locked or backgrounded phone. |

The rate is measured over a trailing two-second window, not averaged across the
session, so it falls to zero within seconds of delivery stopping rather than
decaying slowly while the walk quietly records nothing.

`Tilt lag` is what this page exists to measure: how far behind each inertial
sample its orientation arrived. Orientation and motion are delivered on two
independent, independently throttled channels, so the pairing is always at least
slightly stale. **That number is the open question blocking device-frame
captures from counting as evidence** — see
[Known seams](../architecture/known-seams.md#orientation-is-projected-but-a-device-frame-walk-is-still-not-evidence).

## What you get

Stopping validates the capture and offers it as a download. An invalid capture
offers no download at all: `exportCaptureSession` refuses to serialise one, and
routing around that to hand over a file the schema rejects would be worse than
losing it.

A downloaded capture can be sealed once you have a checkpoint manifest for it:

```bash
npm run evidence -- seal walk-....capture.json manifest.json artifact.json
```

It will seal as `unsupported-sensor-model`. That is correct and not a failure —
the evidence policy admits only `native/world/deg/s`, and a browser reports the
device frame. See [Sealing and checking an evidence artifact](evidence-artifact.md).

## What this cannot do yet

- **No position fix.** The reference venue's anchors are `kind: image`, and
  nothing scans them, so the walk never localizes. Dead reckoning integrates a
  heading and steps from an unknown starting point.
- **No ground-truth marks.** There is no control for laying down a surveyed
  checkpoint mid-walk, so nothing measures error against anything.

Both are needed before a walk can produce an accuracy figure. Neither is needed
to measure the tilt lag, which is what this page is for today.
