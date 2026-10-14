import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

function worker(options: { failPut?: boolean; offline?: boolean; cached?: boolean } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const puts: string[] = [], added: string[][] = [];
  let skipped = 0;
  let fetched = 0;
  const cache = {
    addAll: async (urls: string[]) => { added.push(urls); },
    add: async (url: string) => { added.push([url]); },
    put: async (request: Request | string) => { if (options.failPut) throw new Error('測試容量不足'); puts.push(typeof request === 'string' ? request : request.url); },
    match: async () => undefined,
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL, Response, Request,
    self: { location: { origin: 'https://note.example.test' }, skipWaiting: async () => { skipped++; }, clients: { claim: async () => {} }, addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback) },
    fetch: async () => { fetched++; if (options.offline) throw new TypeError('測試離線'); return new Response('公開外殼', { headers: { 'Content-Type': 'text/html' } }); },
    caches: { open: async () => cache, keys: async () => [], match: async () => options.cached ? new Response('舊版雜湊資源') : undefined },
  });
  return { listeners, puts, added, skipped: () => skipped, fetched: () => fetched };
}

it('PWA-05：僅攔截公開 GET，導覽鍵不保存私人查詢且快取故障不阻擋網路', async () => {
  const sw = worker();
  for (const path of ['/api/session', '/api/v1/pages', '/login/confirm?token=fixture', '/parties/sync/id', '/cdn-cgi/rum', '/__test/reset', '/health', '/unknown', 'https://other.example.test/assets/app.js']) {
    let intercepted = false;
    sw.listeners.get('fetch')!({ request: new Request(path.startsWith('https:') ? path : 'https://note.example.test' + path), respondWith: () => { intercepted = true; } });
    expect(intercepted, path).toBe(false);
  }
  let intercepted = false;
  sw.listeners.get('fetch')!({ request: new Request('https://note.example.test/assets/app.js', { method: 'POST' }), respondWith: () => { intercepted = true; } });
  expect(intercepted).toBe(false);
  let response: Promise<Response> | undefined;
  sw.listeners.get('fetch')!({ request: { url: 'https://note.example.test/?page=fixture&draft=fixture', method: 'GET', mode: 'navigate' }, respondWith: (value: Promise<Response>) => { response = value; } });
  expect((await response!).status).toBe(200);
  const existing = worker({ cached: true, offline: true });
  existing.listeners.get('fetch')!({ request: new Request('https://note.example.test/assets/app-old.js'), respondWith: (value: Promise<Response>) => { response = value; } });
  expect(await (await response!).text()).toBe('舊版雜湊資源');
  expect(existing.fetched()).toBe(0);
  expect(sw.puts).toEqual(['/']);
  const failing = worker({ failPut: true });
  failing.listeners.get('fetch')!({ request: new Request('https://note.example.test/assets/app.js'), respondWith: (value: Promise<Response>) => { response = value; } });
  expect((await response!).status).toBe(200);
});

it('PWA-06：安裝完成才等待啟用，只接受明確的更新訊息', async () => {
  const sw = worker();
  let work: Promise<unknown> | undefined;
  const waitUntil = (value: Promise<unknown>) => { work = value; };
  sw.listeners.get('install')!({ waitUntil }); await work;
  expect(sw.added.flat()).toContain('/manifest.webmanifest');
  expect(sw.skipped()).toBe(0);
  sw.listeners.get('message')!({ data: { type: 'skip-waiting' }, waitUntil }); await work;
  expect(sw.skipped()).toBe(1);
});

it('CACHE-PLATFORM-01：POST 分析紀錄不能轉成 GET 啟動快取並阻擋編輯器', async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const downloaded: string[] = [];
  const replies: unknown[] = [];
  const origin = 'https://note.tonypepe.com';
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL, self: { location: { origin }, addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback) },
    caches: { open: async () => ({ match: async () => undefined, addAll: async (urls: string[]) => {
      if (urls.some(url => new URL(url).pathname.startsWith('/cdn-cgi/'))) throw new Error('分析端點 GET 回 405');
      downloaded.push(...urls);
    } }) },
  });
  let work: Promise<unknown> | undefined;
  listeners.get('message')!({ data: { type: 'cache-resources', urls: [
    origin + '/assets/app.js', origin + '/cdn-cgi/rum', origin + '/cdn-cgi/challenge-platform/script',
    origin + '/api/session', origin + '/login/confirm?token=fixture', 'https://static.cloudflareinsights.com/beacon.min.js',
  ] }, ports: [{ postMessage: (value: unknown) => replies.push(value) }], waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  expect(replies).toEqual([{ ok: true }]);
  expect(downloaded).toEqual([origin + '/assets/app.js']);
});
