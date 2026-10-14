const SHELL_CACHE = 'p-note-shell-v3';
const cacheable = url => ['http:', 'https:'].includes(url.protocol) && url.origin === self.location.origin
  && !['/api/', '/__test/', '/parties/', '/login/', '/cdn-cgi/'].some(path => url.pathname.startsWith(path));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.add('/')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('p-note-') && key !== SHELL_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !cacheable(url)) return;
  event.respondWith(fetch(request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(async () => {
    return await caches.match(request, { ignoreSearch: request.mode === 'navigate', ignoreVary: true })
      ?? new Response('離線且沒有快取', { status: 503 });
  }));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'cache-resources' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      if (event.data.urls.length > 500) throw new Error('資源清單超限');
      const urls = [...new Set(event.data.urls)].filter(value => typeof value === 'string' && cacheable(new URL(value)));
      const missing = [];
      for (const url of urls) if (!await cache.match(url, { ignoreVary: true })) missing.push(url);
      await cache.addAll(missing); event.ports[0]?.postMessage({ ok: true });
    } catch { event.ports[0]?.postMessage({ ok: false }); }
  })());
});
