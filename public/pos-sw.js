const CACHE_NAME = 'doubletime-pos-v15';
const POS_BUNDLE_PATTERN = /^\/assets\/pos-[^/]+\.(?:js|css)$/;
const APP_SHELL = [
  '/pos/',
  '/pos-manifest.webmanifest',
  '/assets/DT-LOGO-APPLETOUCH.png',
  '/assets/DT-LOGO-APPLETOUCH-192.png',
  '/assets/DT-LOGO-APPLETOUCH-512.png',
  '/assets/DT-LOGO-TAB-ICON.png',
  '/assets/DT-LOGO-001.png',
  '/assets/cocoloco-front-view-pos.webp',
  '/assets/DT-MAT-SLT-pos.webp',
  '/assets/21-pos.webp',
  '/assets/22-pos.webp',
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

async function storeFreshResponse(cacheKey, response, pathname) {
  const cache = await caches.open(CACHE_NAME);
  if (POS_BUNDLE_PATTERN.test(pathname)) {
    const extension = pathname.endsWith('.css') ? '.css' : '.js';
    const keys = await cache.keys();
    await Promise.all(keys.filter((request) => {
      const cachedPath = new URL(request.url).pathname;
      return POS_BUNDLE_PATTERN.test(cachedPath) && cachedPath.endsWith(extension) && cachedPath !== pathname;
    }).map((request) => cache.delete(request)));
  }
  await cache.put(cacheKey, response);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok && (event.request.mode === 'navigate' || url.pathname.startsWith('/assets/') || url.pathname === '/pos-manifest.webmanifest')) {
          const copy = response.clone();
          const cacheKey = event.request.mode === 'navigate' ? '/pos/' : event.request;
          await storeFreshResponse(cacheKey, copy, url.pathname).catch(() => undefined);
        }
        return response;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/pos/');
        return Response.error();
      }
    })(),
  );
});
