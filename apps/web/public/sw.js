// Ekybot Service Worker
// BUMP THIS VERSION TO FORCE CACHE INVALIDATION
const CACHE_NAME = 'ekybot-v8';
// Cache essential assets for offline support
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

// Install - cache static assets in background (non-blocking)
self.addEventListener('install', (event) => {
  // Skip waiting immediately - don't block installation
  self.skipWaiting();
  
  // Cache assets in background (don't wait for it)
  caches.open(CACHE_NAME).then((cache) => {
    cache.addAll(STATIC_ASSETS).catch(() => {
      // Ignore cache errors - not critical
    });
  });
});

// Activate - clean old caches and notify clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Listen for skip waiting message from client
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip non-http(s) requests (chrome-extension://, etc.)
  if (!event.request.url.startsWith('http')) {
    return;
  }
  
  // Skip API and auth requests
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('clerk')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and cache successful responses
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(async () => {
        // Fallback to cache, but always return a real Response object.
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        return new Response('', {
          status: 503,
          statusText: 'Offline fallback unavailable',
        });
      })
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '🦅 Ekybot';
  const options = {
    body: data.body || 'Nouveau message',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/v3',
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const url = event.notification.data?.url || '/v3';
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
