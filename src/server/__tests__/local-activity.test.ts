// The relay's activity buffer.
//
// Everything that reads relay activity reads this: the on-screen stream, the
// tab badge, and the remote dump admin pulls over the socket. It is also the
// only part of the system that must keep working while the relay is failing,
// so the properties asserted here are the ones that make it trustworthy:
// it records with nobody listening, one request stays one row, and a request
// that was never answered stays visible as unanswered.
//
// Module-level state, so each test re-imports for a clean buffer.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { RelayActivityEntry } from '../websocket';

type Mod = typeof import('../local-activity');

async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import('../local-activity');
}

/** `at` is seconds since the epoch, matching the rest of the stream. */
function socketEntry(at: number, over: Partial<RelayActivityEntry> = {}): RelayActivityEntry {
  return { lane: 'socket', at, action: 'accessories.list', phase: 'sent', id: `r-${at}`, ...over };
}

let mod: Mod;

beforeEach(async () => {
  mod = await freshModule();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recording', () => {
  it('records with no listener attached', () => {
    // The premise of the whole design: a fault worth reading about happens
    // before anyone opens the panel.
    expect(mod.hasLocalActivityListeners()).toBe(true);
    mod.emitLocalRelayActivity(socketEntry(100));
    expect(mod.getBufferedActivity()).toHaveLength(1);
  });

  it('never throws out of a failing listener', () => {
    mod.onLocalRelayActivity(() => { throw new Error('viewer blew up'); });
    // Called from the request path — a diagnostic must not be able to break
    // the thing it describes.
    expect(() => mod.emitLocalRelayActivity(socketEntry(100))).not.toThrow();
    expect(mod.getBufferedActivity()).toHaveLength(1);
  });

  it('replaces a pending request with its outcome rather than adding a row', () => {
    mod.emitLocalRelayActivity(socketEntry(100));
    mod.emitLocalRelayActivity(socketEntry(100, { phase: 'ok', ms: 12 }));

    const held = mod.getBufferedActivity();
    expect(held).toHaveLength(1);
    expect(held[0].phase).toBe('ok');
    expect(held[0].ms).toBe(12);
  });

  it('keeps an unmatched outcome rather than dropping it', () => {
    // The pending row can have been evicted by the ring. Losing the outcome
    // too would erase the request entirely.
    mod.emitLocalRelayActivity(socketEntry(100, { phase: 'failed', error: 'HOME_NOT_FOUND' }));
    expect(mod.getBufferedActivity()).toHaveLength(1);
  });

  it('evicts oldest first once full', () => {
    for (let i = 0; i < 2100; i++) {
      mod.emitLocalRelayActivity(socketEntry(i, { id: `r-${i}`, phase: 'ok' }));
    }
    const held = mod.getBufferedActivity();
    expect(held).toHaveLength(2000);
    // Newest first.
    expect(held[0].at).toBe(2099);
    expect(held[held.length - 1].at).toBe(100);
  });
});

describe('payload bounding', () => {
  // Measured on the live relay before this existed: a single bridge-lane
  // `accessories.list` response was 1.6 MB, the buffer held 12 MB across 320
  // entries, and asking for a 300-entry page disconnected the relay outright.
  const huge = { accessories: Array.from({ length: 400 }, (_, i) => ({ id: `a${i}`, blob: 'x'.repeat(200) })) };

  it('collapses an oversized response to a shape summary', () => {
    mod.emitLocalRelayActivity({ lane: 'bridge', at: 1, action: 'accessories.list', phase: 'ok', response: huge });

    const [held] = mod.getBufferedActivity();
    expect(JSON.stringify(held).length).toBeLessThan(2500);
    // The size is the diagnostic, so it survives even though the contents don't.
    expect(JSON.stringify(held.response)).toContain('truncated');
    expect(JSON.stringify(held.response)).toContain('400 items');
  });

  it('bounds every payload-bearing field, not just the ones a call site remembered', () => {
    mod.emitLocalRelayActivity({
      lane: 'automation', at: 1, name: 'Big',
      steps: huge.accessories as unknown as Record<string, unknown>[],
      triggerData: huge as unknown as Record<string, unknown>,
      request: huge, response: huge, value: huge,
    });
    expect(JSON.stringify(mod.getBufferedActivity()[0]).length).toBeLessThan(4000);
  });

  it('leaves small payloads exactly as they were', () => {
    const small = { homeId: 'ABC', on: true };
    mod.emitLocalRelayActivity({ lane: 'socket', at: 1, action: 'characteristic.set', phase: 'ok', request: small });
    expect(mod.getBufferedActivity()[0].request).toEqual(small);
  });

  it('does not mutate the caller’s entry', () => {
    const entry = { lane: 'bridge' as const, at: 1, action: 'x', phase: 'ok' as const, response: huge };
    mod.emitLocalRelayActivity(entry);
    // The caller still owns its object — this is called from the request path.
    expect(entry.response).toBe(huge);
  });

  it('evicts on total bytes, not only on entry count', () => {
    // Each of these is capped to ~2KB, so 4MB of them is far fewer than the
    // 2000-entry ceiling — byte pressure has to be what evicts.
    for (let i = 0; i < 2000; i++) {
      mod.emitLocalRelayActivity({ lane: 'bridge', at: i, action: 'accessories.list', phase: 'ok', response: huge });
    }
    const held = mod.getBufferedActivity();
    const bytes = JSON.stringify(held).length;
    expect(bytes).toBeLessThanOrEqual(4_100_000);
    expect(held.length).toBeGreaterThan(0);
  });
});

describe('getActivityStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
  });

  it('reports an empty buffer without inventing a timestamp', () => {
    expect(mod.getActivityStats()).toEqual({ buffered: 0, stuck: 0, faults: 0, lastAt: 0 });
  });

  it('counts only requests outstanding past the threshold', () => {
    const now = Date.now() / 1000;
    mod.emitLocalRelayActivity(socketEntry(now - 30, { id: 'old' }));   // stuck
    mod.emitLocalRelayActivity(socketEntry(now - 1, { id: 'recent' })); // still normal
    mod.emitLocalRelayActivity(socketEntry(now - 30, { id: 'done', phase: 'ok', ms: 5 }));

    const stats = mod.getActivityStats();
    expect(stats.stuck).toBe(1);
    expect(stats.buffered).toBe(3);
  });

  it('stops counting a request once its outcome lands', () => {
    const now = Date.now() / 1000;
    mod.emitLocalRelayActivity(socketEntry(now - 30, { id: 'r1' }));
    expect(mod.getActivityStats().stuck).toBe(1);

    mod.emitLocalRelayActivity(socketEntry(now - 30, { id: 'r1', phase: 'failed', error: 'timeout' }));
    // A failure is an answer. The badge is for requests with no answer at all.
    expect(mod.getActivityStats().stuck).toBe(0);
  });

  it('reports when the newest entry landed', () => {
    mod.emitLocalRelayActivity(socketEntry(100, { phase: 'ok' }));
    mod.emitLocalRelayActivity(socketEntry(140, { id: 'r2', phase: 'ok' }));
    expect(mod.getActivityStats().lastAt).toBe(140);
  });
});

describe('getActivityDump', () => {
  beforeEach(() => {
    for (let i = 1; i <= 10; i++) {
      mod.emitLocalRelayActivity({
        lane: i % 2 === 0 ? 'homekit' : 'socket',
        at: i,
        action: `a${i}`,
        phase: 'ok',
        id: `r-${i}`,
      });
    }
  });

  it('returns newest first, matching the panel', () => {
    const dump = mod.getActivityDump({ limit: 3 });
    expect(dump.entries.map((e) => e.at)).toEqual([10, 9, 8]);
    expect(dump.buffered).toBe(10);
    expect(dump.oldestAt).toBe(1);
  });

  it('pages backwards without repeating or skipping an entry', () => {
    const first = mod.getActivityDump({ limit: 4 });
    expect(first.nextBefore).toBe(7);

    const second = mod.getActivityDump({ limit: 4, before: first.nextBefore });
    expect(second.entries.map((e) => e.at)).toEqual([6, 5, 4, 3]);

    const third = mod.getActivityDump({ limit: 4, before: second.nextBefore });
    expect(third.entries.map((e) => e.at)).toEqual([2, 1]);
    // Nothing older left, so no invitation to ask again.
    expect(third.nextBefore).toBeUndefined();
  });

  it('filters by lane', () => {
    const dump = mod.getActivityDump({ lane: 'homekit', limit: 100 });
    expect(dump.entries.every((e) => e.lane === 'homekit')).toBe(true);
    expect(dump.entries).toHaveLength(5);
    // `buffered` stays the whole buffer, so a caller can tell it is filtered.
    expect(dump.buffered).toBe(10);
  });

  it('caps a page by bytes, so a dump cannot be what breaks the relay', async () => {
    const big = await freshModule();
    // Just under the per-field cap, so each row is retained whole — that is the
    // case the page cap exists for. Rows large enough to be summarised on the
    // way in are already small by the time they get here.
    const chunky = { blob: 'y'.repeat(1900) };
    for (let i = 0; i < 400; i++) {
      big.emitLocalRelayActivity({ lane: 'bridge', at: i, action: 'accessories.list', phase: 'ok', response: chunky });
    }
    const dump = big.getActivityDump({ limit: 400 });
    expect(JSON.stringify(dump.entries).length).toBeLessThanOrEqual(520_000);
    // Truncated by bytes, so there is more to fetch and it says so.
    expect(dump.entries.length).toBeLessThan(400);
    expect(dump.nextBefore).toBeDefined();
  });

  it('always returns one entry, so paging cannot stall on an oversized row', async () => {
    const big = await freshModule();
    for (let i = 0; i < 3; i++) {
      big.emitLocalRelayActivity({
        lane: 'bridge', at: i, action: 'x', phase: 'ok',
        response: { rows: Array.from({ length: 5000 }, (_, n) => `r${n}`) },
      });
    }
    expect(big.getActivityDump({ limit: 3 }).entries.length).toBeGreaterThanOrEqual(1);
  });

  it('caps the page size, because this is fetched over the relay socket', async () => {
    const big = await freshModule();
    for (let i = 0; i < 900; i++) {
      big.emitLocalRelayActivity({ lane: 'socket', at: i, action: 'x', phase: 'ok', id: `r-${i}` });
    }
    expect(big.getActivityDump({ limit: 10_000 }).entries).toHaveLength(500);
    expect(big.getActivityDump({ limit: 0 }).entries).toHaveLength(1);
  });
});

describe('fault retention', () => {
  // Every attempt to catch the HOME_NOT_FOUND on the local fast path failed
  // because the buffer covers minutes and the fault is intermittent. Faults
  // therefore outlive the traffic that buried them.
  it('keeps a fault after the rolling buffer has moved past it', () => {
    mod.emitLocalRelayActivity(socketEntry(1, { id: 'bad', phase: 'failed', error: 'HOME_NOT_FOUND' }));
    for (let i = 0; i < 2500; i++) {
      mod.emitLocalRelayActivity(socketEntry(100 + i, { id: `ok-${i}`, phase: 'ok', ms: 3 }));
    }

    expect(mod.getBufferedActivity().some((e) => e.error === 'HOME_NOT_FOUND')).toBe(false);
    const dump = mod.getActivityDump({ faultsOnly: true, limit: 50 });
    expect(dump.entries.some((e) => e.error === 'HOME_NOT_FOUND')).toBe(true);
    expect(mod.getActivityStats().faults).toBeGreaterThan(0);
  });

  it('treats a request evicted while still unanswered as a fault', () => {
    // Its outcome would have replaced it in place, so one that ages out still
    // reading `sent` was never answered — the silent-relay signature.
    mod.emitLocalRelayActivity(socketEntry(1, { id: 'never-answered' }));
    for (let i = 0; i < 2500; i++) {
      mod.emitLocalRelayActivity(socketEntry(100 + i, { id: `ok-${i}`, phase: 'ok', ms: 3 }));
    }

    const dump = mod.getActivityDump({ faultsOnly: true, limit: 50 });
    expect(dump.entries.some((e) => e.id === 'never-answered')).toBe(true);
  });

  it('does not record an answered request as a fault', () => {
    mod.emitLocalRelayActivity(socketEntry(1, { id: 'fine' }));
    mod.emitLocalRelayActivity(socketEntry(1, { id: 'fine', phase: 'ok', ms: 4 }));
    for (let i = 0; i < 2500; i++) {
      mod.emitLocalRelayActivity(socketEntry(100 + i, { id: `ok-${i}`, phase: 'ok', ms: 3 }));
    }
    expect(mod.getActivityDump({ faultsOnly: true, limit: 50 }).entries
      .some((e) => e.id === 'fine')).toBe(false);
  });

  it('reports faults separately from the buffer, so neither count hides the other', () => {
    mod.emitLocalRelayActivity(socketEntry(1, { id: 'x', phase: 'failed', error: 'boom' }));
    const dump = mod.getActivityDump({});
    expect(dump.buffered).toBe(1);
    expect(dump.faults).toBe(1);
  });
});
