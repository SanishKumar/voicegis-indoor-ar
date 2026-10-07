import { describe, expect, it } from 'vitest';
import { visibleInspectorLabels, type InspectorLabelCandidate } from './inspectorLabels';

const viewport = { left: 0, top: 0, right: 400, bottom: 300 };
const label = (id: string, priority: number, left: number, top = 50): InspectorLabelCandidate => ({
  id,
  priority,
  bounds: { left, top, right: left + 100, bottom: top + 24 },
});

describe('readable Inspector label collision', () => {
  it('keeps the destination ahead of connectors, entrances and neighbouring room names', () => {
    expect([
      ...visibleInspectorLabels(
        [
          label('room', 30, 60),
          label('entrance', 60, 70),
          label('connector', 80, 80),
          label('destination', 100, 90),
        ],
        viewport,
      ),
    ]).toEqual(['destination']);
  });

  it('retains a spaced entrance and POI alongside a connector', () => {
    expect([
      ...visibleInspectorLabels(
        [label('room', 30, 250), label('entrance', 60, 140), label('connector', 80, 30)],
        viewport,
      ),
    ]).toEqual(['connector', 'entrance', 'room']);
  });

  it('resolves ties identically even when the DOM traversal order changes', () => {
    const candidates = [label('b', 30, 60), label('a', 30, 50), label('c', 30, 250)];
    expect(visibleInspectorLabels(candidates, viewport)).toEqual(
      visibleInspectorLabels([...candidates].reverse(), viewport),
    );
    expect([...visibleInspectorLabels(candidates, viewport)]).toEqual(['a', 'c']);
  });

  it('does not show a clipped name or one under Inspector chrome', () => {
    const reserved = [{ left: 0, top: 0, right: 200, bottom: 60 }];
    expect([
      ...visibleInspectorLabels(
        [
          label('off-left', 100, -10),
          label('under-chrome', 80, 20, 40),
          label('readable', 30, 250),
        ],
        viewport,
        reserved,
      ),
    ]).toEqual(['readable']);
  });

  it('reconsiders previously suppressed names after camera movement and resizing', () => {
    const crowded = [label('a', 30, 50), label('b', 30, 60)];
    expect([...visibleInspectorLabels(crowded, viewport)]).toEqual(['a']);
    expect([...visibleInspectorLabels([crowded[0], label('b', 30, 200)], viewport)]).toEqual([
      'a',
      'b',
    ]);
    expect([
      ...visibleInspectorLabels([crowded[0], label('b', 30, 200)], { ...viewport, right: 250 }),
    ]).toEqual(['a']);
  });

  it('ignores unmeasurable labels and keeps a real gap between readable names', () => {
    const invalid = label('invalid', 100, Number.NaN);
    expect([
      ...visibleInspectorLabels([invalid, label('a', 30, 50), label('b', 30, 155)], viewport),
    ]).toEqual(['a']);
  });
});
