const CACHE_NAME = 'deck-cache-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const assetManifest = await fetch('asset-manifest.json').then(res => res.json());
      const assets = assetManifest.files;
      assets.push('./');
      await cache.addAll(assets);
    } catch (e) {
      console.error('Failed to fetch asset-manifest.json, offline mode will not be available.', e);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keyList) => {
    return Promise.all(keyList.map((key) => {
      if (key !== CACHE_NAME) {
        return caches.delete(key);
      }
    }));
  }));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);

      const networkPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse.ok) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      });

      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 400));
      
      try {
        const firstResponse = await Promise.race([networkPromise, timeoutPromise]);
        if (firstResponse) {
          return firstResponse; // Network was fast enough
        }
      } catch(e) {
        // networkPromise rejected before timeout, fall through to cache
      }

      // If network is slow or failed, return from cache if available, otherwise wait for network.
      return cachedResponse || networkPromise;
    })()
  );
});
