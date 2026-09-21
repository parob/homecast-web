import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  fetchResolution, fixStatus, mergeLabel, mergeOutstanding, mergeResolution, mergesNow, offersResolution,
  planStatus, shortPr, type MergePlanEntry, type Resolution,
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

describe('fixStatus — the word on a row', () => {
  it('reads Fix proposed while a PR is open, Fixed once closed, and nothing otherwise', () => {
    expect(fixStatus(row(['bug', 'claude-pr-open']))).toBe('Fix proposed');
    expect(fixStatus(row(['bug', 'claude-pr-open'], 'closed'))).toBe('Fixed');
    expect(fixStatus(row(['bug', 'claude-attempted'], 'closed'))).toBe('Fixed');
    expect(fixStatus(row(['bug', 'claude-attempted']))).toBeNull();
    expect(fixStatus(row([]))).toBeNull();
  });
});

describe('shortPr', () => {
  it('reads as repo#number', () => {
    expect(shortPr({ repo: 'parob/homecast-web', number: 208, url: '' })).toBe('homecast-web#208');
  });
});

const planEntry = (repo: string, number: number, over: Partial<MergePlanEntry>): MergePlanEntry => ({
  repo, number, url: `https://github.com/${repo}/pull/${number}`, title: null, state: 'open',
  merged: false, mergeSha: null, mergeable: true, checks: 'success', action: 'merge', reason: null, ...over,
});

describe('the merge plan, read for the button', () => {
  const cloud = planEntry('parob/homecast-cloud', 170, {});
  const web = planEntry('parob/homecast-web', 214, { action: 'wait_deploy', reason: 'homecast-cloud#170 is merged but not serving yet' });

  it('names the one PR a tap merges, counts them when there are more, and is null with nothing to merge', () => {
    expect(mergeLabel([cloud, web])).toBe('Merge homecast-cloud#170');
    expect(mergeLabel([cloud, { ...web, action: 'merge' }])).toBe('Merge 2 pull requests');
    expect(mergeLabel([{ ...cloud, action: 'merged', merged: true }, web])).toBeNull();
    expect(mergeLabel([])).toBeNull();
    expect(mergesNow([cloud, web]).map((e) => e.number)).toEqual([170]);
  });

  it('knows whether anything is still to do', () => {
    expect(mergeOutstanding([{ ...cloud, action: 'merged', merged: true }, web])).toBe(true);
    expect(mergeOutstanding([{ ...cloud, action: 'merged', merged: true }, { ...web, action: 'merged', merged: true }])).toBe(false);
  });

  it('puts each place in the plan into a word or two', () => {
    expect(planStatus(cloud)).toBe('Ready');
    expect(planStatus(web)).toBe('Waits for deploy');
    expect(planStatus({ ...cloud, action: 'merged', merged: true, serving: true })).toBe('Merged · serving');
    expect(planStatus({ ...cloud, action: 'merged', merged: true, serving: false })).toBe('Merged · deploying');
    expect(planStatus({ ...web, action: 'merged', merged: true })).toBe('Merged');
    expect(planStatus({ ...web, action: 'after', reason: 'after homecast-web#214' })).toBe('after homecast-web#214');
    expect(planStatus({ ...web, action: 'blocked', reason: 'merge conflict' })).toBe('merge conflict');
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

describe('mergeResolution', () => {
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

  it('posts to the merge endpoint with the token and returns the plan the server answers with', async () => {
    const state = { configured: true, servingSha: '4ae7930', merged: [], plan: [] };
    const fetchMock = answer(200, state);
    await expect(mergeResolution(169, 'tok')).resolves.toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/rest/issue-report/169/resolution/merge',
      { method: 'POST', headers: { authorization: 'Bearer tok' } },
    );
  });

  it('says merging is not set up on a 409, and relays the server\'s reason otherwise', async () => {
    answer(409, { error: 'Merging is not set up on this server.' });
    await expect(mergeResolution(169, 'tok')).rejects.toThrow("isn't set up");
    answer(502, { error: 'Could not reach GitHub to merge.' });
    await expect(mergeResolution(169, 'tok')).rejects.toThrow('Could not reach GitHub');
    answer(403);
    await expect(mergeResolution(169, 'tok')).rejects.toThrow('admin');
  });
});
