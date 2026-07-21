# ADR 0002: Describe the camera overlay as a preview, not AR

- Status: Accepted
- Date: 2026-07-22

## Context

The prototype opened the rear camera and drew a screen-centered 2D arrow. It had no camera pose, building-to-world transform, anchor, surface detection, localization, or automatic progress. Calling this “AR navigation” overstated the implementation and obscured the actual work required.

The canvas backing size was also reassigned on every animation frame, causing repeated clearing and allocation.

## Decision

The product and code call this view **Camera Preview**. The UI explicitly states that it is screen-aligned and not spatially anchored. QR localization is labeled planned rather than shown as a functioning action.

Canvas size is updated through `ResizeObserver`; animation frames draw only. Device pixel ratio is capped to avoid excessive mobile backing buffers.

## Consequences

- Reviewers can trust implemented-versus-planned labels.
- The preview remains useful for testing camera permissions and instruction presentation.
- World-anchored AR will be introduced only with pose alignment, localization quality, progress gates, and relocalization behavior.
