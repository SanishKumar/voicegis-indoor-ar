import { describe, expect, it, vi } from 'vitest';
import { LatestActivationQueue } from './latestActivationQueue';

describe('latest activation queue', () => {
  it('serializes a successor behind in-flight cache mutation so the successor commits last', async () => {
    const queue = new LatestActivationQueue();
    let current = 1;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const committed: number[] = [];

    const first = queue.run(
      () => current === 1,
      async () => {
        markFirstStarted();
        await firstGate;
        committed.push(1);
        return 1;
      },
    );
    await firstStarted;
    current = 2;
    const second = queue.run(
      () => current === 2,
      async () => {
        committed.push(2);
        return 2;
      },
    );
    releaseFirst();

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(committed).toEqual([1, 2]);
  });

  it('does not mutate storage for work already superseded before its turn', async () => {
    const queue = new LatestActivationQueue();
    const task = vi.fn(async () => 'stale');

    await expect(queue.run(() => false, task)).resolves.toBeNull();
    expect(task).not.toHaveBeenCalled();
  });
});
