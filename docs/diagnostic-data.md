# Visitor diagnostic reports

This describes the optional visitor **Test log**, not a legal privacy policy
for a particular deployment. Ordinary visitors do not get a field log unless
diagnostics are enabled with `?fieldtest=1` or were enabled in this tab earlier.

## What it includes

- Browser user-agent text, viewport size, pixel ratio, build and venue IDs/hash.
- Advertised camera, motion, orientation, speech, WebXR and offline-worker support.
- Tracking/camera/AR state transitions, sign identifiers, floor, route progress,
  uncertainty, stride totals, timing and aggregate sensor-availability details.
- Placement/recovery outcomes, direction corrections and camera error messages.

The log has no camera images, audio recordings or raw continuous sensor stream.
It is nevertheless potentially sensitive: venue/sign identifiers, floor and
movement history can describe a visit. Review it before sharing, especially
when testing in a real hospital or another sensitive setting.

## Lifetime and control

The buffer holds at most 500 events in JavaScript memory, dropping older
events as it fills. Reloading or closing the page loses that buffer. Only the
on/off preference is stored in session storage so check-in navigation and
reloads do not unintentionally change the tester's choice. Browser tab-restore
behavior can preserve that preference, but the app does not persist events.

Opening the log captures a stable snapshot. Recording continues in the
background; **Refresh report** captures a newer snapshot and resets the copy
acknowledgment. **Clear** discards the current buffer and snapshot without
stopping new entries. **Stop logging and clear** additionally disables logging
and sets `fieldtest=0` in the address, without reloading or ending the journey.

Before **Copy report** is enabled, the tester must affirm that they reviewed
the displayed report and want to copy it. The clipboard receives exactly that
snapshot, not later events. Clipboard refusal leaves selectable text and an
explanation. Copying is not sending; the app has no automatic report upload.
Copies in the clipboard, messages or another app are outside this buffer and
are not removed by Clear or Stop. Do not send a report publicly by default.

## Boundaries

- The support probe does not request a sensor permission or start an AR session.
  A failed or timed-out WebXR query returns `unknown`; `yes` means advertised
  support only, not a validated handset or successful floor placement.
- Field logs do not feed positioning, routes, replay or evidence qualification.
  Clearing a log is not a new check-in and cannot recover a lost position.
- Venue packages, settings and offline caches have separate storage lifetimes.
  Stopping diagnostics does not delete those or stop a user-requested camera
  or tracking session.
- Loading the app and venue still makes normal hosting/network requests. The
  host can see requested URLs and standard connection metadata. Hosting access
  logs and their retention depend on the deployment; they are not this log.
- This is not an authenticated support inbox, anonymization service or
  deployment-wide privacy policy. Those need their own design before launch.
