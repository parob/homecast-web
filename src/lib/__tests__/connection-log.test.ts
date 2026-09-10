// @vitest-environment jsdom
//
// parob/homecast-cloud#113: every connection transition shipped as
// `prev=<state>` and nothing else, so a flaky socket left no evidence of *why*
// it kept changing. These pin the line the log now carries, and the fields it
// carries alongside it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  describeTransition,
  duration,
  environmentFacts,
  installEnvironmentBreadcrumbs,
  resetEnvironmentBreadcrumbs,
  transitionMetadata,
} from '../connection-log';

afterEach(() => {
  resetEnvironmentBreadcrumbs();
  vi.restoreAllMocks();
});

describe('duration', () => {
  it('reads as a person would say it', () => {
    expect(duration(0)).toBe('0ms');
    expect(duration(950)).toBe('950ms');
    expect(duration(1500)).toBe('1.5s');
    expect(duration(41_000)).toBe('41s');
    expect(duration(125_000)).toBe('2m 5s');
    expect(duration(180_000)).toBe('3m');
  });
});

describe('describeTransition', () => {
  it('says why, and how long the last state lasted', () => {
    expect(describeTransition({
      prev: 'connected',
      prevMs: 41_000,
      reason: 'close:1006',
      evidence: { clean: false, visibility: 'hidden', online: true, attempt: 1, delay_ms: 1000 },
    })).toBe('prev=connected for 41s · close:1006 · clean=false visibility=hidden online=true attempt=1 delay_ms=1000');
  });

  it('degrades to what it knows, and never to an empty line', () => {
    expect(describeTransition({ prev: 'disconnected' })).toBe('prev=disconnected');
    expect(describeTransition({ prev: 'connecting', reason: 'server-ready' }))
      .toBe('prev=connecting · server-ready');
  });

  it('drops absent evidence rather than printing it as undefined', () => {
    // `close_reason` and `session_ms` are routinely absent — a socket that never
    // opened has no session, and most closes carry no reason string. Printing
    // `close_reason=undefined` is worse than saying nothing.
    expect(describeTransition({
      prev: 'connected',
      reason: 'close:1001',
      evidence: { code: 1001, close_reason: undefined, session_ms: null, clean: true },
    })).toBe('prev=connected · close:1001 · code=1001 clean=true');
  });
});

describe('transitionMetadata', () => {
  it('prefixes the fields so a transition can be picked out without matching the message', () => {
    expect(transitionMetadata('reconnecting', {
      prev: 'connected',
      prevMs: 41_400,
      reason: 'close:1006',
      evidence: { clean: false, attempt: 3 },
    })).toEqual({
      conn_state: 'reconnecting',
      conn_prev: 'connected',
      conn_reason: 'close:1006',
      conn_prev_ms: 41_400,
      conn_clean: false,
      conn_attempt: 3,
    });
  });

  it('keeps the keys present, and null, when there is nothing to say', () => {
    // Null rather than absent: a field that is sometimes missing cannot be
    // grouped on, and "no reason recorded" is itself a finding.
    expect(transitionMetadata('connecting', { prev: 'disconnected' })).toEqual({
      conn_state: 'connecting',
      conn_prev: 'disconnected',
      conn_reason: null,
      conn_prev_ms: null,
    });
  });
});

describe('environmentFacts', () => {
  it('samples what decides most "why did it drop" questions', () => {
    const facts = environmentFacts();
    expect(facts.visibility).toBe(document.visibilityState);
    expect(typeof facts.online).toBe('boolean');
  });
});

describe('installEnvironmentBreadcrumbs', () => {
  const hide = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('records a suspend and how long it lasted', () => {
    const write = vi.fn();
    const teardown = installEnvironmentBreadcrumbs(write);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    hide('hidden');
    expect(write).toHaveBeenLastCalledWith('app: hidden', { visibility: 'hidden' });
    vi.spyOn(Date, 'now').mockReturnValue(1_045_000);
    hide('visible');
    expect(write).toHaveBeenLastCalledWith('app: visible', { visibility: 'visible', away_ms: 45_000 });
    teardown();
  });

  it('records the network flipping', () => {
    const write = vi.fn();
    const teardown = installEnvironmentBreadcrumbs(write);
    window.dispatchEvent(new Event('offline'));
    expect(write).toHaveBeenLastCalledWith('network: offline', { online: false });
    window.dispatchEvent(new Event('online'));
    expect(write).toHaveBeenLastCalledWith('network: online', { online: true });
    teardown();
  });

  it('installs once, however many times it is called', () => {
    const first = vi.fn();
    const second = vi.fn();
    const teardown = installEnvironmentBreadcrumbs(first);
    installEnvironmentBreadcrumbs(second);
    window.dispatchEvent(new Event('offline'));
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    teardown();
  });

  it('stops writing after teardown', () => {
    const write = vi.fn();
    installEnvironmentBreadcrumbs(write)();
    window.dispatchEvent(new Event('offline'));
    expect(write).not.toHaveBeenCalled();
  });
});
