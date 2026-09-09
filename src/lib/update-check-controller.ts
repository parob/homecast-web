/**
 * Noticing that a deploy has landed, and taking it.
 *
 * The decisions are in update-check.ts. This is the part with a clock and a
 * network: it asks /version.json now and then, and when the answer names a
 * build other than this one it shows the user what is about to happen and
 * reloads onto it.
 *
 * ── Why reloadForNewBundle and not location.reload ────────────────────────
 *
 * The service worker answers navigations cache-first, from the shell that
 * names the very chunks we are trying to leave. A plain reload therefore
 * comes back on the same build and detects the same update again.
 * stale-bundle.ts drops both caches and releases the worker, which is what
 * makes the update land in one reload rather than none.
 */

import { toast } from 'sonner';
import { config } from './config';
import { reloadForNewBundle } from './stale-bundle';
import {
  buildToken,
  guardVerdict,
  isNewBuild,
  parseBuildStamp,
  shouldCheckForUpdates,
  shouldDeferReload,
  type BuildStamp,
} from './update-check';

/** One reload per session, keyed on what we were reloading *to*. */
const RELOAD_GUARD_KEY = 'homecast-update-reload';

/** Late enough not to compete with boot, early enough to count as "on open". */
const FIRST_CHECK_DELAY = 10_000;
const CHECK_INTERVAL = 15 * 60_000;
/** A return to the foreground re-checks, but not more often than this. */
const FOREGROUND_MIN_GAP = 5 * 60_000;
/** How often to re-ask whether it has become a polite moment to reload. */
const DEFER_RECHECK = 20_000;
/** Long enough for the indicator to render and be read as an explanation. */
const INDICATOR_MS = 1_200;

function runningStamp(): BuildStamp {
  return {
    version: config.version && config.version !== 'dev' ? config.version : undefined,
    deployedAt: config.deployedAt || undefined,
  };
}

function readGuard(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY);
  } catch {
    return null;
  }
}

function writeGuard(target: string): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, target);
  } catch {
    /* private mode — the reload still happens, it just isn't guarded */
  }
}

function clearGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* private mode */
  }
}

async function fetchServedStamp(): Promise<BuildStamp | null> {
  try {
    const res = await fetch(`${window.location.origin}/version.json?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return parseBuildStamp(await res.json());
  } catch {
    // Offline, a blip, or a captive portal. Silence is right: an update check
    // that fails costs nothing, and the next one is minutes away.
    return null;
  }
}

/**
 * Take the update.
 *
 * Hidden tabs skip the indicator and go straight there — nobody is looking, so
 * there is nothing to explain and no interruption to soften.
 */
function applyUpdate(target: string): void {
  writeGuard(target);
  if (document.visibilityState === 'hidden') {
    reloadForNewBundle();
    return;
  }
  toast.loading('Updating to the latest version…');
  window.setTimeout(() => reloadForNewBundle(), INDICATOR_MS);
}

export function initUpdateCheck(): void {
  const running = runningStamp();
  const eligible = shouldCheckForUpdates({
    dev: import.meta.env.DEV,
    isCommunity: config.isCommunity,
    isRelayMac: !!window.isHomecastMacApp,
    running,
  });
  if (!eligible) return;

  const guard = readGuard();
  switch (guardVerdict(guard, running)) {
    case 'landed':
      clearGuard();
      break;
    case 'stuck':
      console.warn('[update] reload did not land on', guard, '— checks disabled for this session');
      return;
  }

  let stopped = false;
  let lastCheck = 0;
  let deferTimer: number | undefined;

  const takeWhenPolite = (target: string) => {
    if (stopped) return;
    if (!shouldDeferReload(document)) {
      stopped = true;
      window.clearInterval(deferTimer);
      applyUpdate(target);
      return;
    }
    if (deferTimer === undefined) {
      deferTimer = window.setInterval(() => takeWhenPolite(target), DEFER_RECHECK);
    }
  };

  const check = async () => {
    if (stopped) return;
    if (navigator.onLine === false) return;
    lastCheck = Date.now();
    const served = await fetchServedStamp();
    if (!served || !isNewBuild(running, served)) return;
    const target = buildToken(served);
    if (target) takeWhenPolite(target);
  };

  window.setTimeout(() => void check(), FIRST_CHECK_DELAY);
  window.setInterval(() => void check(), CHECK_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheck < FOREGROUND_MIN_GAP) return;
    void check();
  });
}
