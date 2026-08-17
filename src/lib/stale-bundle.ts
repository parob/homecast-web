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
 * Reloading is the entire fix, but a plain `location.reload()` is not enough:
 * the service worker serves navigations from its shell cache first (see
 * ../../service-worker.js), and that cached shell is precisely the document
 * naming the chunks that just disappeared. The first reload after a deploy
 * therefore re-serves the dead shell and fails identically. Drop the shell
 * caches first and the reload has to go to the network.
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

/** Every cached shell, so the next navigation has to ask the network. */
async function dropShellCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.all(
    names.filter((n) => n.startsWith('homecast-shell-')).map((n) => caches.delete(n))
  );
}

/**
 * Reload onto the new bundle. Safe to call from an error path: a Cache API that
 * never settles can't strand the user on a broken screen, because the reload is
 * also on a timer.
 */
export function reloadForNewBundle(): void {
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  window.setTimeout(reload, 1_500);
  void dropShellCaches().then(reload, reload);
}
