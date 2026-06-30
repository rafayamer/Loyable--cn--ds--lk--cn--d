/* The Loyaly service worker — lightweight, dependency-free.
 *
 * Strategy:
 *  - API requests (/api/*) and auth flows are NEVER cached (security: no
 *    sensitive tenant data in the cache). They always go to the network.
 *  - Static hashed assets (scripts, styles, images, fonts) → cache-first.
 *  - Navigations → network-first, falling back ONLY to the offline page.
 *    We deliberately do NOT precache or serve index.html from cache, so a new
 *    deploy is never masked by a stale app shell on mobile/PWA.
 *
 * IMPORTANT: bump CACHE_VERSION on every deploy that must invalidate the
 * cache. Because the bytes of this file then change, the browser detects a
 * new worker, runs activate (which purges old caches) and — via skipWaiting +
 * clients.claim + the controllerchange handler in main.tsx — reloads clients
 * onto the fresh build automatically.
 */
const CACHE_VERSION = 'v2';
const CACHE = 'loyaly-' + CACHE_VERSION;
const SHELL = ['/offline.html', '/white.png', '/black.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache API / auth / cross-origin — always network, no fallback caching.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Navigations: network-first → offline page only (never a cached shell, so a
  // fresh deploy is always served when the device is online).
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Static assets: cache-first, then network (and populate cache).
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
