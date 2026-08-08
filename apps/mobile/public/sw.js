/* global self, caches, fetch, URL */
// Bump on each release that must invalidate preview clients.
const CACHE_NAME = 'ximo-pos-v10-volume-promotions';
const APP_SHELL = /* __XIMO_APP_SHELL__ */ ['/', '/manifest.json', '/ximo-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first so rebuilds (new hashed bundles) are picked up while online.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => {
            // Navigate responses are stored under "/" for offline boot.
            if (request.mode === 'navigate') {
              void cache.put('/', copy);
            } else {
              void cache.put(request, copy);
            }
          });
        }
        return response;
      })
      .catch(() =>
        request.mode === 'navigate' ? caches.match('/') : caches.match(request),
      ),
  );
});
