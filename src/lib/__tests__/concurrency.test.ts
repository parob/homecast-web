import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '../concurrency';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('runWithConcurrency', () => {
  it('returns results index-aligned with the input', async () => {
    const results = await runWithConcurrency([1, 2, 3, 4], 2, async n => n * 10);
    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
      { status: 'fulfilled', value: 40 },
    ]);
  });

  it('keeps a rejection at its own index instead of throwing', async () => {
    const results = await runWithConcurrency([1, 2, 3], 2, async n => {
      if (n === 2) throw new Error('nope');
      return n;
    });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
  });

  it('never exceeds the limit, and still drains the whole list', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    const results = await runWithConcurrency(items, 6, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return true;
    });

    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBe(6); // and it actually saturates, rather than serialising
    expect(results).toHaveLength(20);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });

  it('does not stall the other workers on one slow item', async () => {
    const order: number[] = [];
    await runWithConcurrency([0, 1, 2, 3], 2, async n => {
      // Item 0 is slow; a fixed-size batching implementation would idle a
      // worker waiting for it instead of pulling 2 and 3 forward.
      if (n === 0) { await tick(); await tick(); await tick(); }
      order.push(n);
    });
    expect(order[order.length - 1]).toBe(0);
    expect(order.sort()).toEqual([0, 1, 2, 3]);
  });

  it('handles an empty list and a limit below one', async () => {
    expect(await runWithConcurrency([], 4, async () => 1)).toEqual([]);
    expect(await runWithConcurrency([1, 2], 0, async n => n)).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
    ]);
  });
});
