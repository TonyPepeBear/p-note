export async function api(path: string, body?: object): Promise<Response> {
  return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
}

export async function saveDraft(): Promise<void> {
  if (window.probe) {
    try { await saveLocal(window.probe.cache); }
    catch { throw new Error('本機儲存失敗，已保留目前頁面，請先重試儲存'); }
  }
}

export async function navigate(id?: string): Promise<void> {
  await saveDraft();
  location.assign(id ? '/?page=' + encodeURIComponent(id) : '/');
}
import { saveLocal } from './cache';

