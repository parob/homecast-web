/**
 * Recovering from a deploy that landed under a running session.
 *
 * Vite content-hashes every chunk, so a deploy renames all of them. A tab that
 * is already running still holds the old names, and the first lazy import after
 * that deploy asks for a file which no longer exists.
 *
 * The request does not 404. Firebase answers an unmatched path with the SPA
 * rewrite — index.html, 200, `text/html` — and the `/assets/**` header rule
 * then stamps that document `immutable, max-age=31536000`. So the import fails
 * on MIME type rather than on a missing file, which is why the message reads
 * "Failed to fetch dynamically imported module" and says nothing about a 404.
 *
 * Reloading is the entire fix, but a plain `location.reload()` is not enough,
 * and neither is dropping the shell cache alone. Everything the service worker
 * can still answer a navigation from has to go — see reloadForNewBundle.
 */

// Lowercase — matched against a lowercased message. Browsers word this
// differently and there is no error code to key on.
const STALE_BUNDLE_MESSAGES = [
  'failed to fetch dynamically imported module', // Chrome, Edge
  'error loading dynamically imported module',   // Firefox
  'importing a module script failed',            // Safari / WKWebView
  'unable to preload css',                       // Vite's own preload helper
];

/**
 * Is this the wreckage of a chunk that a deploy renamed out from under us,
 * rather than a real bug? Only ever used to choose a recovery, never to
 * swallow an error.
 *
 * Deliberately broad: every engine words this the same way for a chunk that
 * vanished and for a chunk the network dropped, and there is nothing in the
 * error to tell them apart. isLikelyOffline() is what separates them, because
 * the recovery for the two is not the same.
 */
export function isStaleBundleError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string' || !message) return false;
  const lower = message.toLowerCase();
  return STALE_BUNDLE_MESSAGES.some((m) => lower.includes(m));
}

/**
 * A module that failed to load because the device has no network, not because
 * a deploy renamed it. WebKit's "Importing a module script failed." is the same
 * sentence either way, and on a phone the blip is by far the commoner cause.
 *
 * Only ever trusted in the negative direction: `onLine === false` means there
 * is definitely no network, while `true` means very little. That asymmetry is
 * the point — it is used to *withhold* the destructive recovery, never to
 * trigger it.
 */
export function isLikelyOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Every cache this app serves itself from.
 *
 * Both of them, not just the shell. `homecast-assets` is deliberately NOT
 * versioned by build — chunk URLs are content-hashed, so the URL is the
 * version — which also means an entry written into it outlives every deploy
 * that doesn't happen to rename that chunk. A response cached there before the
 * worker learned to refuse SPA-rewrite fallbacks (see ../../service-worker.js,
 * isFallback) is HTML sitting under a .js URL, and it matches for as long as
 * that chunk's content is unchanged. Dropping only the shell left it in place,
 * so the reload fetched a fresh index.html and then failed on exactly the same
 * chunk — which is what made the Reload button land back on its own screen.
 */
async function dropCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.all(
    names.filter((n) => n.startsWith('homecast-')).map((n) => caches.delete(n))
  );
}

/**
 * Let go of the worker itself, so the reload is answered by the network.
 *
 * A worker only reinstalls when its own bytes change, and its bytes are stamped
 * with the entry chunk's hash. A worker that is a build behind, or whose
 * install failed partway, therefore keeps answering navigations from a shell
 * the page cannot get out of, and no amount of reloading moves it. Unregistering
 * costs one launch of cold start: initServiceWorker() re-registers on the next
 * load and installs a fresh shell.
 */
async function releaseWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
}

/**
 * Reload onto the new bundle.
 *
 * Caches go first and the worker is unregistered alongside them, so that even
 * if the outgoing worker still controls the reloaded navigation — unregistration
 * only completes once the last client unloads, which is a race with the reload —
 * it has nothing left to serve and has to go to the network.
 *
 * Safe to call from an error path: a Cache API that never settles can't strand
 * the user on a broken screen, because the reload is also on a timer.
 */
export function reloadForNewBundle(): void {
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  window.setTimeout(reload, 2_000);
  void Promise.all([dropCaches(), releaseWorker()]).then(reload, reload);
}

/**
 * Retry without touching anything.
 *
 * The offline case: the bundle on disk is fine and the shell cache is the only
 * reason the app opens at all without a network. Clearing it here would turn a
 * passing blip into an app that cannot start until it is back online.
 */
export function retryWithoutClearing(): void {
  window.location.reload();
}
