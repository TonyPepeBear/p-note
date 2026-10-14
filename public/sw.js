const SHELL_CACHE = 'p-note-shell-__P_NOTE_VERSION__';
const PRECACHE = /* __P_NOTE_PRECACHE__ */ ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const cacheable = url => ['http:', 'https:'].includes(url.protocol) && url.origin === self.location.origin
  && (['/', '/probe', '/manifest.webmanifest'].includes(url.pathname)
    || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/fixtures/pixel.png');
const shell = url => ['/', '/probe'].includes(url.pathname);
self.addEventListener('install', event => {
  // 完整下載才可安裝；新版等待使用者保存草稿後明確啟用。
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', event => {
  // 舊分頁仍可能需要上一版雜湊資源；不在更新時刪除其快取或 IndexedDB。
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !cacheable(url)) return;
  const key = shell(url) ? '/' : request;
  event.respondWith((async () => {
    // 雜湊資源不可變，優先使用已保存的版本，避免發布後舊檔已從伺服器移除。
    if (url.pathname.startsWith('/assets/')) {
      try {
        const cached = await caches.match(request, { ignoreVary: true });
        if (cached) return cached;
      } catch { /* 快取讀取失敗時仍可連線下載。 */ }
    }
    return fetch(request).then(async response => {
      if (response.ok && !response.redirected && !/no-store/i.test(response.headers.get('Cache-Control') ?? '')) {
        try {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(key, response.clone());
        } catch { /* 空間不足不能讓成功的網路回應失敗。 */ }
      }
      return response;
    }).catch(async () => {
      const current = await caches.open(SHELL_CACHE);
      return await current.match(key, { ignoreVary: true })
        ?? (!shell(url) ? await caches.match(key, { ignoreVary: true }) : undefined)
        ?? new Response('離線且沒有快取', { status: 503 });
    });
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'skip-waiting') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== 'cache-resources' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      if (event.data.urls.length > 500) throw new Error('資源清單超限');
      const urls = [...new Set(event.data.urls)].filter(value => typeof value === 'string' && cacheable(new URL(value)) && !shell(new URL(value)));
      const missing = [];
      for (const url of urls) if (!await cache.match(url, { ignoreVary: true })) missing.push(url);
      await cache.addAll(missing); event.ports[0]?.postMessage({ ok: true });
    } catch { event.ports[0]?.postMessage({ ok: false }); }
  })());
});
