const CACHE_NAME = 'jphrc-dms-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo.webp',
  '/favicon.ico'
];

// Install Event
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network First, but passthrough cross-origin CDN requests completely
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Let cross-origin requests (CDN, API, etc.) pass through untouched.
  // This prevents the SW from interfering with external loads,
  // and avoids the "Failed to convert value to 'Response'" crash when
  // caches.match() returns undefined for external requests.
  if (url.origin !== self.location.origin) {
    return; // Do NOT call event.respondWith() — browser handles it natively
  }

  // For same-origin requests: try network first, fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((cached) => {
        // Return cached response or a minimal fallback (never return undefined)
        return cached || new Response('Offline — please check your connection', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      });
    })
  );
});
