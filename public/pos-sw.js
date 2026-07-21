const CACHE_NAME = 'doubletime-pos-v6';
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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const page = await fetch('/pos/');
    const html = await page.clone().text();
    await cache.put('/pos/', page);
    const linkedFiles = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((url) => url.startsWith('/assets/'));
    await cache.addAll(linkedFiles);
  })());
  self.skipWaiting();
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

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
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
