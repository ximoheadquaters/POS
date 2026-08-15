/* global self, caches, fetch, URL */
// Bump on each release that must invalidate preview clients.
const CACHE_NAME = 'ximo-pos-v11-invite-setup';
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

  // Never intercept owner setup / auth callback navigations. A broken SW response
  // here drops the one-time invite session before the password can be saved.
  if (
    url.pathname.includes('/accept-invitation') ||
    url.pathname.includes('/auth') ||
    url.searchParams.has('token_hash') ||
    url.searchParams.has('code')
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => {
            if (request.mode === 'navigate') {
              void cache.put('/', copy);
            } else {
              void cache.put(request, copy);
            }
          });
        }
        return response;
      })
      .catch(async () => {
        if (request.mode === 'navigate') {
          const cached = await caches.match('/');
          if (cached) return cached;
        } else {
          const cached = await caches.match(request);
          if (cached) return cached;
        }
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      }),
  );
});
