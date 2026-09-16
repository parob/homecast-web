import { describe, expect, it, vi } from 'vitest';
import { queueCameraRequest } from '../camera-request-queue';

describe('camera capture queue', () => {
  it('serializes one home and gives an opened viewer priority over queued previews', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const first = queueCameraRequest('serial', 0, () => new Promise<void>(resolve => {
      calls.push('first'); release = resolve;
    }));
    const background = queueCameraRequest('serial', 0, async () => { calls.push('background'); });
    const opened = queueCameraRequest('serial', 1, async () => { calls.push('opened'); });
    expect(calls).toEqual(['first']);
    release();
    await Promise.all([first, background, opened]);
    expect(calls).toEqual(['first', 'opened', 'background']);
  });

  it('does not hold up another home and keeps draining after a failed capture', async () => {
    let release!: () => void;
    const first = queueCameraRequest('slow-home', 0, () => new Promise<void>(resolve => { release = resolve; }));
    expect(await queueCameraRequest('other-home', 0, async () => 'independent')).toBe('independent');
    const failed = queueCameraRequest('slow-home', 0, async () => { throw new Error('busy'); });
    const failure = expect(failed).rejects.toThrow('busy');
    const next = vi.fn(async () => 'next');
    const resumed = queueCameraRequest('slow-home', 0, next);
    release();
    await first;
    await failure;
    expect(await resumed).toBe('next');
    expect(next).toHaveBeenCalledOnce();
  });
});
