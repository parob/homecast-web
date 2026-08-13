/**
 * Run `fn` over `items` with at most `limit` in flight at once.
 *
 * Like `Promise.allSettled`, this never rejects — a thrown task becomes a
 * `rejected` result — and results stay index-aligned with `items`, which is
 * what lets a caller pair a failure back to the input that caused it.
 *
 * The cap matters for bulk device writes: firing forty simultaneous requests
 * down one WebSocket buries every other message behind them, and the relay
 * ends up rate-limiting its own HomeKit writes into failures.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  if (items.length === 0) return results;

  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  const worker = async (): Promise<void> => {
    // Each worker claims the next index and keeps going until the list is dry,
    // so a slow item doesn't idle the others the way fixed-size batching does.
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
