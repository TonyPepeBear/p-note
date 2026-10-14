import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

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
