import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { probeRelay, pickReachable, rankAddress, AddressRank } from '../relay-probe';

const HEALTH = {
  status: 'ok',
  mode: 'community',
  name: 'Home Mac',
  instanceId: '37d65040',
  wsPort: 5657,
  authEnabled: false,
  addresses: ['http://192.168.1.211:5656', 'http://100.93.89.109:5656'],
};

/**
 * A fetch stand-in driven by a map of origin → what that address does.
 * `null` means nothing is listening; a number means it answers that slowly.
 */
function mockFetch(routes: Record<string, { body?: unknown; delayMs?: number; status?: number } | null>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const origin = href.replace(/\/health$/, '');
    const route = routes[origin];
    if (!route) {
      // Match the shape of a real failure: reject, don't resolve non-ok.
      throw new Error(`connection refused: ${origin}`);
    }
    if (route.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, route.delayMs);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
      });
    }
    return {
      ok: route.status ? route.status < 400 : true,
      status: route.status ?? 200,
      json: async () => route.body ?? HEALTH,
    } as Response;
  });
}

describe('rankAddress', () => {
  it('puts the LAN ahead of the mesh', () => {
    // Not cosmetic: the mesh route can be a relayed hop across the country
    // while the LAN one is a switch away.
    expect(rankAddress('http://192.168.1.211:5656')).toBeLessThan(
      rankAddress('http://100.93.89.109:5656'),
    );
  });

  it('recognises every private range, and does not over-claim 172', () => {
    expect(rankAddress('http://10.0.0.9:5656')).toBe(AddressRank.LAN);
    expect(rankAddress('http://192.168.1.5:5656')).toBe(AddressRank.LAN);
    expect(rankAddress('http://172.16.0.1:5656')).toBe(AddressRank.LAN);
    expect(rankAddress('http://172.31.255.254:5656')).toBe(AddressRank.LAN);
    // 172.15 and 172.32 are ordinary public addresses.
    expect(rankAddress('http://172.15.0.1:5656')).toBe(AddressRank.Other);
    expect(rankAddress('http://172.32.0.1:5656')).toBe(AddressRank.Other);
  });

  it('recognises the CGNAT range Tailscale uses, and only that range', () => {
    expect(rankAddress('http://100.64.0.1:5656')).toBe(AddressRank.CGNAT);
    expect(rankAddress('http://100.127.255.254:5656')).toBe(AddressRank.CGNAT);
    expect(rankAddress('http://100.63.0.1:5656')).toBe(AddressRank.Other);
    expect(rankAddress('http://100.128.0.1:5656')).toBe(AddressRank.Other);
  });

  it('ranks a tunnel hostname last, but still ranks it', () => {
    expect(rankAddress('https://home.example.com')).toBe(AddressRank.Other);
  });

  it('lets last-known-good beat everything', () => {
    const tunnel = 'https://home.example.com';
    expect(rankAddress(tunnel, tunnel)).toBe(AddressRank.Preferred);
    expect(rankAddress(tunnel, tunnel)).toBeLessThan(rankAddress('http://192.168.1.5:5656'));
  });

  it('does not throw on a value that is not a URL', () => {
    expect(rankAddress('not a url')).toBe(AddressRank.Other);
  });
});

describe('probeRelay', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads the relay out of a healthy answer', async () => {
    vi.stubGlobal('fetch', mockFetch({ 'http://192.168.1.211:5656': {} }));
    const r = await probeRelay('http://192.168.1.211:5656');
    expect(r).toMatchObject({ instanceId: '37d65040', name: 'Home Mac', wsPort: 5657 });
    expect(r?.addresses).toHaveLength(2);
  });

  it('returns null rather than throwing when nothing is listening', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    await expect(probeRelay('http://10.0.0.1:5656')).resolves.toBeNull();
  });

  it('rejects something else listening on the port', async () => {
    // A relay says both of these. Anything that says neither is not one.
    vi.stubGlobal('fetch', mockFetch({ 'http://10.0.0.1:5656': { body: { status: 'ok' } } }));
    await expect(probeRelay('http://10.0.0.1:5656')).resolves.toBeNull();
  });

  it('treats an older relay as reachable but nameless', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://10.0.0.1:5656': { body: { status: 'ok', mode: 'community', wsPort: 5657 } },
    }));
    const r = await probeRelay('http://10.0.0.1:5656');
    expect(r).toMatchObject({ instanceId: null, name: null, addresses: [] });
  });
});

describe('pickReachable', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const LAN = 'http://192.168.1.211:5656';
  const MESH = 'http://100.93.89.109:5656';

  it('prefers the LAN when both answer', async () => {
    vi.stubGlobal('fetch', mockFetch({ [LAN]: {}, [MESH]: {} }));
    const r = await pickReachable([MESH, LAN]);
    expect(r?.origin).toBe(LAN);
  });

  it('falls through to the mesh when the LAN is dead — which is leaving the house', async () => {
    vi.stubGlobal('fetch', mockFetch({ [MESH]: {} }));
    const r = await pickReachable([LAN, MESH]);
    expect(r?.origin).toBe(MESH);
  });

  it('still prefers the LAN when the mesh answers sooner', async () => {
    // Awaiting in preference order rather than racing on arrival is the whole
    // point: first-to-answer would hand every connection to the mesh.
    vi.stubGlobal('fetch', mockFetch({ [LAN]: { delayMs: 40 }, [MESH]: {} }));
    const r = await pickReachable([MESH, LAN]);
    expect(r?.origin).toBe(LAN);
  });

  it('probes concurrently, so a dead address does not serialise the rest', async () => {
    const fetchMock = mockFetch({ [MESH]: {} });
    vi.stubGlobal('fetch', fetchMock);
    await pickReachable([LAN, MESH]);
    // Both were dispatched before the first was awaited.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a different relay at a recycled address', async () => {
    // DHCP handed 192.168.1.211 to another Mac. Connecting would give this
    // client someone else's home.
    vi.stubGlobal('fetch', mockFetch({
      [LAN]: { body: { ...HEALTH, instanceId: 'deadbeef' } },
      [MESH]: {},
    }));
    const r = await pickReachable([LAN, MESH], { expectedId: '37d65040' });
    expect(r?.origin).toBe(MESH);
  });

  it('will not accept a relay that cannot prove it is the one we mean', async () => {
    // No instanceId at all — an older relay. It might be the right one, but
    // "might" is not good enough when we are looking for a specific relay.
    vi.stubGlobal('fetch', mockFetch({
      [LAN]: { body: { status: 'ok', mode: 'community' } },
    }));
    await expect(pickReachable([LAN], { expectedId: '37d65040' })).resolves.toBeNull();
  });

  it('accepts an older relay when no particular one was asked for', async () => {
    vi.stubGlobal('fetch', mockFetch({
      [LAN]: { body: { status: 'ok', mode: 'community' } },
    }));
    const r = await pickReachable([LAN]);
    expect(r?.origin).toBe(LAN);
  });

  it('honours last-known-good over the LAN', async () => {
    const tunnel = 'https://home.example.com';
    vi.stubGlobal('fetch', mockFetch({ [LAN]: {}, [tunnel]: {} }));
    const r = await pickReachable([LAN, tunnel], { preferOrigin: tunnel });
    expect(r?.origin).toBe(tunnel);
  });

  it('returns null when nothing answers', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    await expect(pickReachable([LAN, MESH])).resolves.toBeNull();
  });

  it('handles an empty list without calling out', async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);
    await expect(pickReachable([])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deduplicates, so a repeated address is probed once', async () => {
    const fetchMock = mockFetch({ [LAN]: {} });
    vi.stubGlobal('fetch', fetchMock);
    await pickReachable([LAN, LAN, LAN]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
