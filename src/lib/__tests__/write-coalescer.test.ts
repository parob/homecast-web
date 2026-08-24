// The bug: a two-second slider drag on a flaky link puts eight writes in
// flight at once, the relay spawns each concurrently, and HomeKit can apply
// them in any order — so the bulb settles on a value that is not the last one
// the user chose, while the cache holds the value that was.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  coalescedWrite, writeKey, hasOutstandingWrite, __resetWriteCoalescer,
} from '../write-coalescer';

const KEY = writeKey('acc-1', 'brightness');

/** A sender whose individual calls can be settled by hand, in any order. */
function controllableSender() {
  const calls: Array<{ value: unknown; resolve: () => void; reject: (e: unknown) => void }> = [];
  const send = vi.fn((value: unknown) => new Promise<unknown>((resolve, reject) => {
    calls.push({ value, resolve: () => resolve(undefined), reject });
  }));
  return { send, calls, sentValues: () => calls.map(c => c.value) };
}

beforeEach(() => __resetWriteCoalescer());

describe('coalescedWrite', () => {
  it('sends immediately when nothing is travelling', () => {
    const { send } = controllableSender();
    void coalescedWrite(KEY, 10, send);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(10);
  });

  it('holds a second write rather than racing it', () => {
    const { send } = controllableSender();
    void coalescedWrite(KEY, 10, send);
    void coalescedWrite(KEY, 20, send);
    expect(send).toHaveBeenCalledOnce();
  });

  // The whole point.
  it('drops the middle of a drag and sends only the last value', async () => {
    const s = controllableSender();
    void coalescedWrite(KEY, 10, s.send);          // goes out at once
    void coalescedWrite(KEY, 30, s.send);          // queued
    void coalescedWrite(KEY, 60, s.send);          // supersedes 30
    void coalescedWrite(KEY, 90, s.send);          // supersedes 60

    s.calls[0].resolve();
    await Promise.resolve(); await Promise.resolve();

    expect(s.sentValues()).toEqual([10, 90]);
  });

  it('never has two writes out for one control at the same time', async () => {
    const s = controllableSender();
    for (const v of [10, 20, 30, 40, 50]) void coalescedWrite(KEY, v, s.send);
    expect(s.send).toHaveBeenCalledOnce();

    s.calls[0].resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.sentValues()).toEqual([10, 50]);
  });

  it('keeps controls independent of each other', () => {
    const s = controllableSender();
    void coalescedWrite(writeKey('acc-1', 'brightness'), 10, s.send);
    void coalescedWrite(writeKey('acc-1', 'hue'), 200, s.send);
    void coalescedWrite(writeKey('acc-2', 'brightness'), 50, s.send);
    expect(s.send).toHaveBeenCalledTimes(3);
  });
});

describe('what the caller is told', () => {
  it('resolves a superseded write instead of rejecting it', async () => {
    // Rejecting would revert a tile the user has already moved past — the very
    // confusion this exists to prevent.
    const s = controllableSender();
    void coalescedWrite(KEY, 10, s.send);
    const superseded = coalescedWrite(KEY, 30, s.send);
    void coalescedWrite(KEY, 90, s.send);

    await expect(superseded).resolves.toBeUndefined();
  });

  it('rejects the write that actually failed', async () => {
    const s = controllableSender();
    const first = coalescedWrite(KEY, 10, s.send);
    s.calls[0].reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
  });

  it('reports the failure of the value that was last sent', async () => {
    const s = controllableSender();
    void coalescedWrite(KEY, 10, s.send);
    const last = coalescedWrite(KEY, 90, s.send);

    s.calls[0].resolve();
    await Promise.resolve(); await Promise.resolve();
    s.calls[1].reject(new Error('device refused'));

    await expect(last).rejects.toThrow('device refused');
  });

  it('still sends the queued value after the one before it failed', async () => {
    // It has never been attempted, and it is the only version of the user's
    // intent that is still current. That is not a replay.
    const s = controllableSender();
    const first = coalescedWrite(KEY, 10, s.send);
    void coalescedWrite(KEY, 90, s.send);

    s.calls[0].reject(new Error('boom'));
    await expect(first).rejects.toThrow();

    expect(s.sentValues()).toEqual([10, 90]);
  });
});

describe('bookkeeping', () => {
  it('reports an outstanding write while one is travelling or waiting', async () => {
    const s = controllableSender();
    void coalescedWrite(KEY, 10, s.send);
    expect(hasOutstandingWrite(KEY)).toBe(true);

    void coalescedWrite(KEY, 90, s.send);
    expect(hasOutstandingWrite(KEY)).toBe(true);

    s.calls[0].resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(hasOutstandingWrite(KEY)).toBe(true); // 90 is now travelling

    s.calls[1].resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(hasOutstandingWrite(KEY)).toBe(false);
  });

  it('does not leak an entry once everything has settled', async () => {
    const s = controllableSender();
    const p = coalescedWrite(KEY, 10, s.send);
    s.calls[0].resolve();
    await p;
    expect(hasOutstandingWrite(KEY)).toBe(false);
  });

  it('starts clean again after a failure', async () => {
    const s = controllableSender();
    const p = coalescedWrite(KEY, 10, s.send);
    s.calls[0].reject(new Error('x'));
    await expect(p).rejects.toThrow();
    expect(hasOutstandingWrite(KEY)).toBe(false);

    void coalescedWrite(KEY, 20, s.send);
    expect(s.sentValues()).toEqual([10, 20]);
  });
});
