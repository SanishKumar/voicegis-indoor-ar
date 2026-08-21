/**
 * Which view the visitor surface should render.
 *
 * The visitor surface renders a floor map or a camera preview and nothing else,
 * but `activeView` is shared navigation state that any surface can write. The
 * inspector used to store `spatial-twin` in it, and since the visitor surface
 * matched neither of its two branches the result was a shell containing an
 * empty `<main>` — no map, no camera, no error. Both header toggles read
 * `aria-pressed="false"`, which is the signature of this bug.
 *
 * The write has been removed, but the derivation stays: a surface that cannot
 * render a value it did not choose should fall back to its own default rather
 * than render nothing. Anything that is not the camera preview is the map.
 */

export const VISITOR_VIEW = {
  MAP: 'map',
  CAMERA_PREVIEW: 'camera-preview',
} as const;

export type VisitorView = (typeof VISITOR_VIEW)[keyof typeof VISITOR_VIEW];

export function visitorViewFor(activeView: unknown): VisitorView {
  return activeView === VISITOR_VIEW.CAMERA_PREVIEW
    ? VISITOR_VIEW.CAMERA_PREVIEW
    : VISITOR_VIEW.MAP;
}
