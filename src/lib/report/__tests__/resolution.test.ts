import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  fetchResolution, offersResolution, shortPr, type Resolution,
} from '../resolution';

/**
 * Which rows offer a fix, and how the fetch degrades.
 *
 * The degrade case is the one that matters: the web deploys minutes before
 * the server does, so for a while every tap lands on a server without the
 * endpoint. That has to read as "nothing recorded", never as a failure.
 */

vi.mock('@/lib/config', () => ({ config: { apiUrl: 'https://api.test' } }));

const row = (labels: string[], state = 'open') => ({ labels, state });

describe('offersResolution', () => {
  it('offers one while the routine has a PR open for it', () => {
    expect(offersResolution(row(['bug', 'claude-pr-open']))).toBe(true);
  });

  it('offers one on a closed report, whose label has usually come off by then', () => {
    expect(offersResolution(row(['bug', 'claude-attempted'], 'closed'))).toBe(true);
  });

  it('offers nothing on an open report nobody has a fix for', () => {
    expect(offersResolution(row(['bug', 'claude-attempted']))).toBe(false);
    expect(offersResolution(row([]))).toBe(false);
  });
});

describe('shortPr', () => {
  it('reads as repo#number', () => {
    expect(shortPr({ repo: 'parob/homecast-web', number: 208, url: '' })).toBe('homecast-web#208');
  });
});

describe('fetchResolution', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const answer = (status: number, body?: unknown) => {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('asks the server for that issue, with the token', async () => {
    const resolution: Resolution = {
      issueNumber: 167, title: 't', state: 'open', url: null, labels: [], summary: null,
      reach: null, primary: null, prs: [], evidence: [], reported: [],
    };
    const fetchMock = answer(200, resolution);

    await expect(fetchResolution(167, 'tok')).resolves.toEqual(resolution);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/rest/issue-report/167/resolution',
      { headers: { authorization: 'Bearer tok' } },
    );
  });

  it('is null, not an error, on a server that has no such endpoint or issue', async () => {
    answer(404);
    await expect(fetchResolution(167, 'tok')).resolves.toBeNull();
  });

  it('says why when the account is not allowed', async () => {
    answer(403);
    await expect(fetchResolution(167, 'tok')).rejects.toThrow('admin');
  });

  it('fails plainly on anything else', async () => {
    answer(502);
    await expect(fetchResolution(167, 'tok')).rejects.toThrow('Could not load');
  });
});
