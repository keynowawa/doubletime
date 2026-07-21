const CACHE_NAME = 'doubletime-pos-v9';
const APP_SHELL = [
  '/pos/',
  '/pos-manifest.webmanifest',
  '/assets/pos-icon-192.png',
  '/assets/pos-icon-512.png',
  '/assets/DT-LOGO-001.png',
  '/assets/cocoloco-front-view.webp',
  '/assets/DT-MAT-SLT-pos.webp',
  '/assets/21.webp',
  '/assets/22.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && (event.request.mode === 'navigate' || url.pathname.startsWith('/assets/') || url.pathname === '/pos-manifest.webmanifest')) {
          const copy = response.clone();
          const cacheKey = event.request.mode === 'navigate' ? '/pos/' : event.request;
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/pos/');
        return Response.error();
      }),
  );
});
