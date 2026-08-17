/**
 * Homecast service worker.
 *
 * Emitted to /sw.js by `serviceWorkerPlugin` in vite.config.ts, which
 * substitutes __BUILD_SHA__. That substitution is load-bearing: a browser only
 * reinstalls a worker whose bytes changed, so a worker that didn't vary per
 * build would install once and serve the same shell forever.
 *
 * Why this exists: the Mac and iOS apps load the UI from homecast.cloud, so
 * every cold start used to be a network round trip before anything rendered,
 * and no network meant no app at all. WebKit only runs service workers under
 * WKAppBoundDomains (see Resources/Info.plist) — hence the narrow, explicit
 * caching here rather than a generated Workbox bundle.
 *
 * Two caches, deliberately versioned differently:
 *
 *   shell   — index.html. Versioned by build, because its content changes
 *             while its URL doesn't.
 *   assets  — /assets/*. NOT versioned by build: Vite content-hashes these, so
 *             the URL already is the version, and versioning the cache too
 *             would throw away every still-valid chunk on each deploy and make
 *             the first launch after a deploy slow again.
 */

const BUILD = '__BUILD_SHA__';
const SHELL_CACHE = `homecast-shell-${BUILD}`;
const ASSET_CACHE = 'homecast-assets';

// The one entry in the shell cache. Every SPA route resolves to this document,
// which is also what Firebase's rewrite does server-side.
const SHELL_URL = '/index.html';

// Content-hashed assets accumulate across deploys and nothing else evicts
// them. Cache.keys() returns insertion order, so trimming from the front drops
// the least recently added.
const ASSET_LIMIT = 200;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // cache: 'reload' so a stale HTTP-cache copy can't become the thing we
      // then serve for the lifetime of this build.
      const response = await fetch(SHELL_URL, { cache: 'reload' });
      // Refuse to install on anything but a good document. Caching a 500 or a
      // captive-portal interception here would pin it for this whole build,
      // and the shell is the one thing with no content hash to save us.
      if (!response.ok) throw new Error(`shell fetch failed: ${response.status}`);
      await cache.put(SHELL_URL, response);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('homecast-shell-') && n !== SHELL_CACHE)
          .map((n) => caches.delete(n))
      );
      await purgeFallbacks();
      await trimAssets();
      await self.clients.claim();
    })()
  );
});

/**
 * Evict rewrite fallbacks an earlier worker stored (see isFallback). The asset
 * cache is never versioned, so without this a session that hit a dead chunk
 * before this fix keeps serving that HTML from disk with no way out. Bounded by
 * ASSET_LIMIT and entirely local, so it costs one pass per deploy.
 */
async function purgeFallbacks() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  await Promise.all(
    keys.map(async (request) => {
      const hit = await cache.match(request);
      if (hit && isFallback(hit)) await cache.delete(request);
    })
  );
}

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT)).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything not a plain same-origin GET is none of our business — that
  // includes every call to api.homecast.cloud, which must reach the network
  // untouched. Range requests are skipped because a 206 is not a cacheable
  // whole-resource response.
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(serveShell(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(serveAsset(request));
  }

  // Everything else — /version.json, /config.json, /robots.txt, backgrounds —
  // falls through to the network. version.json in particular has to stay live:
  // it's how a deploy is verified.
});

/**
 * Navigations are served from cache first. That is the whole point — it's what
 * removes the network from app launch and what makes the app open offline.
 * A deploy still lands, because a changed worker reinstalls and refetches the
 * shell on the next launch.
 */
async function serveShell(request) {
  const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
  if (cached) return cached;

  try {
    return await fetch(request);
  } catch {
    // Offline on the very first launch after install, before install() ever
    // completed. Nothing cached and no network: let the app's native error
    // page handle it rather than returning a broken document.
    return Response.error();
  }
}

/**
 * Content-hashed, so a hit can never be stale — a given URL always means the
 * same bytes. Cache-first with no revalidation is both safe and the fastest
 * thing available.
 */
async function serveAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Only store our own successful, non-opaque responses. An opaque or error
  // response cached here would be indistinguishable from a good one later —
  // and so would the rewrite fallback, which is why isFallback exists.
  if (response.ok && response.type === 'basic' && !isFallback(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * A hashed asset that a deploy removed does NOT 404. Firebase's SPA rewrite
 * answers the unmatched path with index.html — 200, text/html — and the
 * /assets/** header rule stamps it immutable for a year.
 *
 * That response is `ok` and `basic`, so the check above would happily store a
 * document under a script URL, in a cache that is deliberately never versioned
 * by build. Nothing would ever evict it before the 200-entry trim. Refuse it:
 * the import then fails, and the app reloads onto the new bundle instead.
 */
function isFallback(response) {
  return (response.headers.get('content-type') || '').includes('text/html');
}
