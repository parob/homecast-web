/**
 * Service worker registration.
 *
 * The worker exists for the native apps: they load this UI from homecast.cloud,
 * so without it every cold start is a network round trip before anything
 * renders, and no network means no app. See ../../service-worker.js.
 *
 * Registration is deliberately narrow. It runs only on the cloud hosts, where
 * the app is served remotely and caching is the whole point. Community mode is
 * already served from the Mac app's own bundle over localhost, so a worker
 * there would add a staleness layer to something that is local by construction.
 */

const SW_HOSTS = new Set(['homecast.cloud', 'www.homecast.cloud', 'staging.homecast.cloud']);

function shouldRegister(): boolean {
  // The dev server rebuilds constantly; a caching worker would fight it.
  if (import.meta.env.DEV) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!SW_HOSTS.has(window.location.hostname)) return false;

  // Not on the relay Mac. It runs continuously, so it has almost nothing to
  // gain from a faster cold start — and it has a lot to lose: relay code is
  // shipped by deploying the web app, and the worker adds a launch of delay
  // before new code takes effect. That path is already one restart long; two
  // would make emergency relay fixes materially harder to land.
  const w = window as Window & { isHomecastMacApp?: boolean };
  if (w.isHomecastMacApp) return false;

  return true;
}

export function initServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  if (!shouldRegister()) {
    // Kill switch. If this origin ever had a worker — because it used to be
    // eligible, or because SW_HOSTS shrank — tear it down rather than leaving
    // an orphan serving a shell nobody can update. Flipping SW_HOSTS is
    // therefore a complete rollback on its own.
    void navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    return;
  }

  // After load: registration competes with the first paint for bandwidth
  // otherwise, which would make the first visit slower to buy speed on later
  // ones.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((err) => {
      // A failure here costs nothing but speed — the app runs from the network
      // exactly as it did before. Never surface it to the user.
      console.warn('[sw] registration failed', err);
    });
  });
}
