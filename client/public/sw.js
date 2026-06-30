/* The Loyaly — SELF-DESTRUCT service worker.
 *
 * The PWA cache repeatedly served stale builds after deploys (a controlling
 * service worker is NOT bypassed by a hard refresh), which made new versions
 * appear "not deployed". We have removed the PWA. This worker exists only to
 * REMOVE any previously-installed worker from returning browsers:
 *   - takes control immediately,
 *   - deletes all caches,
 *   - unregisters itself,
 *   - reloads open tabs so they load the live build straight from the network.
 *
 * After this runs once per browser, no service worker controls the app and every
 * request goes directly to the server — no more stale-version problems.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore */ }
    try {
      await self.registration.unregister();
    } catch (e) { /* ignore */ }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) { /* ignore */ }
  })());
});

// Never intercept fetches — everything goes straight to the network.
