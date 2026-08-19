/**
 * Asking a relay "are you there, and are you the one I mean?".
 *
 * A relay is reachable at several addresses at once — on the LAN, over a mesh
 * VPN, through a tunnel — and which of them works depends on where the client
 * is standing. Rather than storing one address and hoping, we ask all of them
 * and take the best answer.
 */

/** What a relay says about itself on `/health`. */
export interface RelayHealth {
  /** The origin that answered — not necessarily the one stored. */
  origin: string;
  /** Stable relay id. Null on relays older than the TXT/instanceId work. */
  instanceId: string | null;
  /** Display name, falling back to the machine's hostname on the relay side. */
  name: string | null;
  wsPort: number | null;
  /** Null when the relay has not reported yet — read as "unknown", not "no". */
  authEnabled: boolean | null;
  /** Every origin the relay believes it can be reached at. */
  addresses: string[];
}

/**
 * How good an address is *before* we know whether it answers.
 *
 * Lower is better. The order matters more than it looks: a LAN address that
 * answers is worth preferring over a mesh one that also answers, because the
 * mesh route can be a relayed DERP hop halfway across the country while the
 * LAN one is a switch away.
 */
export const enum AddressRank {
  Preferred = 0,
  LAN = 1,
  CGNAT = 2,
  Other = 3,
}

/** RFC1918, plus loopback, which is the relay talking to itself. */
function isPrivateLAN(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local')) return true;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const n = parts.map(p => Number(p));
  if (n.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return false;
  if (n[0] === 10 || n[0] === 127) return true;
  if (n[0] === 192 && n[1] === 168) return true;
  // 172.16.0.0/12 is 172.16 through 172.31 — not all of 172.
  if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return true;
  return false;
}

/**
 * 100.64.0.0/10 — carrier-grade NAT, where Tailscale and most mesh VPNs live.
 * Reachable from anywhere on the mesh, which is exactly why it is worth
 * keeping, but it is never a LAN address and should not be preferred over one.
 */
function isCGNAT(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const n = parts.map(p => Number(p));
  if (n.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return false;
  return n[0] === 100 && n[1] >= 64 && n[1] <= 127;
}

export function rankAddress(origin: string, preferOrigin?: string | null): AddressRank {
  if (preferOrigin && origin === preferOrigin) return AddressRank.Preferred;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return AddressRank.Other;
  }
  if (isPrivateLAN(host)) return AddressRank.LAN;
  if (isCGNAT(host)) return AddressRank.CGNAT;
  // A tunnel or public hostname. It works from anywhere, which is why it is
  // kept, but it is the longest way round when something nearer is up.
  return AddressRank.Other;
}

/**
 * Ask one origin whether a Homecast relay is listening there.
 *
 * Never throws and never rejects: an unreachable address is an ordinary answer
 * here, not an error, and `pickReachable` awaits these in order — one rejection
 * would take the whole race down with it.
 */
export async function probeRelay(origin: string, timeoutMs = 3000): Promise<RelayHealth | null> {
  try {
    const resp = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const d = await resp.json();
    // Something else may well be listening on 5656. Only a relay says both.
    if (d?.status !== 'ok' || d?.mode !== 'community') return null;
    return {
      origin,
      instanceId: typeof d.instanceId === 'string' && d.instanceId ? d.instanceId : null,
      name: typeof d.name === 'string' && d.name ? d.name : null,
      wsPort: typeof d.wsPort === 'number' && d.wsPort > 0 ? d.wsPort : null,
      authEnabled: typeof d.authEnabled === 'boolean' ? d.authEnabled : null,
      addresses: Array.isArray(d.addresses) ? d.addresses.filter((a: unknown) => typeof a === 'string') : [],
    };
  } catch {
    return null;
  }
}

export interface PickOptions {
  /**
   * The relay we mean. A probe answering with a different id is rejected: DHCP
   * recycles addresses, and silently binding to whichever Mac now holds
   * 192.168.1.211 would hand someone else's home to this client.
   */
  expectedId?: string | null;
  /** Last known good, tried first — usually right, and free when it is. */
  preferOrigin?: string | null;
  timeoutMs?: number;
}

/**
 * The best address that answers, or null if none do.
 *
 * Every candidate is probed **concurrently**, but awaited in preference order.
 * That gets both halves right: a dead LAN address costs nothing extra because
 * the mesh probe has been running alongside it the whole time, and a live LAN
 * address wins even when a slower mesh route would also have worked.
 */
export async function pickReachable(
  origins: string[],
  { expectedId = null, preferOrigin = null, timeoutMs = 3000 }: PickOptions = {},
): Promise<RelayHealth | null> {
  const unique = Array.from(new Set(origins.filter(Boolean)));
  if (unique.length === 0) return null;

  const ranked = unique
    .map(origin => ({ origin, rank: rankAddress(origin, preferOrigin) }))
    .sort((a, b) => a.rank - b.rank)
    .map(r => r.origin);

  // Start them all now; await below in preference order.
  const inFlight = ranked.map(origin => probeRelay(origin, timeoutMs));

  for (const probe of inFlight) {
    const health = await probe;
    if (!health) continue;
    if (expectedId) {
      // An older relay reports no id at all. If we are looking for a specific
      // one, "no id" cannot be shown to be it, so it does not qualify.
      if (health.instanceId !== expectedId) continue;
    }
    return health;
  }
  return null;
}
