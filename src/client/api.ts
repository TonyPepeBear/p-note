import { saveLocal } from './cache';

const SIGNED_OUT = 'p-note:signed-out';
const metadataDrafts = new Set<{ save: () => Promise<void>; dirty: () => boolean }>();
export function registerDraft(save: () => Promise<void>, dirty: () => boolean): () => void {
  const entry = { save, dirty };
  metadataDrafts.add(entry);
  return () => { metadataDrafts.delete(entry); };
}
export function hasMetadataDrafts(): boolean {
  return [...metadataDrafts].some(entry => entry.dirty());
}

export async function api(path: string, body?: object, signal?: AbortSignal, headers?: HeadersInit): Promise<Response> {
  const requestHeaders = new Headers(headers);
  if (body) requestHeaders.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : { cache: 'no-store' as const }), ...(body || headers ? { headers: requestHeaders } : {}), ...(signal ? { signal } : {}) });
  try {
    if (response.status === 401 || (path === '/api/logout' && response.ok)) localStorage.setItem(SIGNED_OUT, '1');
    else if (response.ok && !body && /^\/api\/(session$|pages\/[\w-]+$|today(?:\?|$))/.test(path)) localStorage.removeItem(SIGNED_OUT);
  } catch { /* 無法記錄時仍以伺服器回應為準。 */ }
  return response;
}

export function signedOut(): boolean {
  try { return localStorage.getItem(SIGNED_OUT) !== null; } catch { return true; }
}

export async function saveDraft(): Promise<void> {
  for (const entry of metadataDrafts) if (entry.dirty()) await entry.save();
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
  if (ticket !== latest) return;
  const url = id ? '/?page=' + encodeURIComponent(id) : '/';
  history.replaceState({ ...history.state, scrollY }, '');
  history.pushState({ scrollY: 0 }, '', url);
  window.dispatchEvent(new CustomEvent('p-note:navigate', { detail: { fresh } }));
  void reloadIfOutdated(ticket, url, fresh);
}

async function reloadIfOutdated(ticket: number, url: string, fresh: boolean) {
  if (!(await outdated()) || ticket !== latest) return;
  // 鎖住編輯器，避免保存後才輸入的字在整頁載入時遺失。
  const editor = window.probe?.editor;
  if (editor) editor.isEditable = false;
  try {
    await saveDraft();
  } catch (failure) {
    if (editor) editor.isEditable = true;
    window.dispatchEvent(new CustomEvent('p-note:error', { detail: (failure as Error).message }));
    return;
  }
  if (ticket !== latest) {
    if (editor) editor.isEditable = true;
    return;
  }
  // 以目前網址為準：版本查詢期間使用者可能已用上一頁／下一頁換到別頁。
  const here = location.pathname + location.search;
  location.assign(here === url && fresh && url !== '/' ? url + '&new=1' : here);
}
