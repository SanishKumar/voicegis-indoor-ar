export interface InspectorLabelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InspectorLabelCandidate {
  id: string;
  priority: number;
  bounds: InspectorLabelBounds;
}

const intersects = (a: InspectorLabelBounds, b: InspectorLabelBounds, padding: number) =>
  a.left < b.right + padding &&
  a.right + padding > b.left &&
  a.top < b.bottom + padding &&
  a.bottom + padding > b.top;

/** Keep readable screen-space names apart, rather than shrinking them to fit. */
export function visibleInspectorLabels(
  candidates: readonly InspectorLabelCandidate[],
  viewport: InspectorLabelBounds,
  reserved: readonly InspectorLabelBounds[] = [],
  padding = 6,
): Set<string> {
  const shown = new Set<string>();
  const occupied = [...reserved];
  const sorted = [...candidates].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
  for (const candidate of sorted) {
    const b = candidate.bounds;
    if (
      ![b.left, b.top, b.right, b.bottom].every(Number.isFinite) ||
      b.right <= b.left ||
      b.bottom <= b.top
    )
      continue;
    if (
      b.left < viewport.left ||
      b.right > viewport.right ||
      b.top < viewport.top ||
      b.bottom > viewport.bottom
    )
      continue;
    if (occupied.some((other) => intersects(b, other, padding))) continue;
    shown.add(candidate.id);
    occupied.push(b);
  }
  return shown;
}
