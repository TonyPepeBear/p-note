const SHELL_CACHE = 'p-note-shell-v2';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.add('/')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('p-note-') && key !== SHELL_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/__test/') || url.pathname.startsWith('/parties/') || url.pathname.startsWith('/login/')) return;
  event.respondWith(fetch(request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(async () => {
    return await caches.match(request, { ignoreSearch: request.mode === 'navigate' })
      ?? new Response('離線且沒有快取', { status: 503 });
  }));
});
