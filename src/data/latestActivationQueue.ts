export class LatestActivationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(isCurrent: () => boolean, task: () => Promise<T>): Promise<T | null> {
    const execute = async () => {
      if (!isCurrent()) return null;
      return task();
    };
    const result = this.tail.then(execute, execute);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
