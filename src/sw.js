const scope = new URL(self.registration.scope);
const cachePrefix = 'deck-shell:' + encodeURIComponent(scope.href) + ':';
const cacheName = cachePrefix + 'DECK_SHELL_REVISION';
const assets = new URL('assets/', scope).href;
const shellManifest = new URL('asset-manifest.json', scope);
const home = scope.href;
const index = new URL('index.html', scope).href;

async function shellFiles() {
  const response = await fetch(shellManifest, {cache: 'no-store'});
  if (!response.ok) throw new Error('Could not load the Deck application asset manifest');
  const {files} = await response.json();
  return files.map(file => new URL(file, scope).href);
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const files = await shellFiles();
      const cache = await caches.open(cacheName);
      await cache.addAll(files.map(url => new Request(url, {cache: 'reload'})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      await Promise.all(['deck-cache-v1', 'deck-cache-v2'].map(key => caches.delete(key)));
      await Promise.all(
        (await caches.keys())
          .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
          .map(key => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  const page = url.origin + url.pathname;
  if (request.mode !== 'navigate' || (page !== home && page !== index)) {
    // The install step is the sole writer for preloaded UI assets.
    if (request.method === 'GET' && url.href.startsWith(assets)) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(cacheName);
          return (await cache.match(request)) ?? fetch(request);
        })(),
      );
    }
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error('Could not load Deck');
        return response;
      } catch (error) {
        const saved = await cache.match(page);
        if (saved) return saved;
        throw error;
      }
    })(),
  );
});
