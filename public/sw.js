/**
 * Larimar service worker.
 *
 * DELIBERATELY CONSERVATIVE. This application renders a bearer credential for
 * cash, and a service worker cache is readable by any script that later runs on
 * this origin and survives a browser restart. The usual PWA advice — "cache API
 * responses for offline speed" — would place transaction data, and in one case a
 * live pickup code, into durable client-side storage. That is not a trade worth
 * making for a faster dashboard.
 *
 * So the rules are:
 *
 *   - Cache ONLY immutable, non-personal static assets (hashed build output and
 *     brand icons).
 *   - NEVER touch /api/*. Every one of those responses is authenticated, and
 *     PUT /api/transactions/:id/payment returns the plaintext pickup code exactly
 *     once. It must not be persisted anywhere.
 *   - NEVER cache an HTML document. Every page is server-rendered per session;
 *     a cached one could show a previous user's dashboard on a shared device.
 *   - Serve a small offline notice when navigation fails, and nothing more.
 *
 * The value delivered is installability and a graceful offline message. That is
 * the correct amount of offline capability for a product whose every meaningful
 * action requires the server.
 */

const VERSION = 'larimar-v1';
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline.html';

/** Precached at install: the offline shell and the brand icons it references. */
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Hashed build output and brand icons only. Nothing user-specific, ever. */
function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET is ever eligible. A cached POST/PUT is meaningless here and a
  // replayed financial mutation would be dangerous.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Hard exclusion, stated twice on purpose: nothing under /api/ is cached,
  // inspected, or stored. Let it go straight to the network.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation: always network. Fall back to a static offline notice, never to a
  // cached page — a cached dashboard on a shared phone is a data leak.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  if (!isCacheableAsset(url)) return;

  // Cache-first for immutable assets. Build output is content-hashed, so a stale
  // hit is impossible for anything that matters.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

/**
 * Clear every cache on demand.
 *
 * The sign-out flow posts this so nothing of the previous session survives on a
 * shared device. Belt and braces, since no personal data should be cached in the
 * first place.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'larimar:purge') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
  }
});
