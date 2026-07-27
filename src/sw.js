/**
 * Deck's service worker: an offline copy of a published deck.
 *
 * Strategy is network-first with a short leash. A deck is documentation, so
 * being a version behind is worse than being a moment slower — but only up to a
 * point, and past that point the cached copy wins. A cache-first worker would
 * serve yesterday's card to someone who just published a fix.
 */

const CACHE_NAME = 'deck-cache-v2';
const NETWORK_TIMEOUT_MS = 400;

const scoped = pathname => new URL(pathname, self.registration.scope).toString();

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      let assets;
      try {
        const response = await fetch(scoped('asset-manifest.json'), {cache: 'no-cache'});
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        assets = [...(await response.json()).files, './'];
      } catch (err) {
        console.error('Deck: no asset manifest; offline mode is unavailable.', err);
        return;
      }

      // One at a time rather than `cache.addAll`, which is all-or-nothing: a
      // single asset that 404s would otherwise leave the deck with no offline
      // copy at all, rather than an offline copy missing one file.
      const results = await Promise.allSettled(assets.map(asset => cache.add(asset)));
      const failed = results.filter(result => result.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`Deck: ${failed} of ${assets.length} assets could not be cached.`);
      }
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Only same-origin GETs are ours to answer. `cache.put` throws on anything
  // else, and taking over a cross-origin request buys nothing.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const network = fetch(request).then(response => {
        if (response.ok && response.type === 'basic') {
          // Cloned before the body is read: a response body can only be
          // consumed once, and the caller is about to consume this one.
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      });

      const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));

      try {
        const winner = await Promise.race([network, timeout]);
        if (winner) return winner;
      } catch {
        // The network failed outright; fall through to the cache.
      }

      const cached = await cache.match(request);
      if (cached) return cached;

      // Nothing cached: the slow network response is the only answer there is.
      return await network;
    })(),
  );
});
