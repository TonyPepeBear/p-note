export async function api(path: string, body?: object): Promise<Response> {
  return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
}

export async function saveDraft(): Promise<void> {
  if (window.probe) {
    try { await saveLocal(window.probe.cache); }
    catch { throw new Error('本機儲存失敗，已保留目前頁面，請先重試儲存'); }
  }
}

const entry = (html: string) => /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];

async function outdated(): Promise<boolean> {
  const current = document.querySelector('script[type="module"][src]')?.getAttribute('src');
  if (!current) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const next = entry(await (await fetch('/', { cache: 'no-store', signal: controller.signal })).text());
    return !!next && next !== current;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let latest = 0;

export async function navigate(id?: string, fresh = false): Promise<void> {
  const ticket = ++latest;
  await saveDraft();
  const url = id ? '/?page=' + encodeURIComponent(id) : '/';
  const reload = await outdated();
  if (ticket !== latest) return;
  if (reload) {
    location.assign(url + (id && fresh ? '&new=1' : ''));
    return;
  }
  history.replaceState({ ...history.state, scrollY }, '');
  history.pushState({ scrollY: 0 }, '', url);
  window.dispatchEvent(new CustomEvent('p-note:navigate', { detail: { fresh } }));
}
import { saveLocal } from './cache';

