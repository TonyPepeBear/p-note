import { saveDraft } from './api';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
let prompt: InstallPrompt | undefined;
let registration: ServiceWorkerRegistration | undefined;
let registering: Promise<ServiceWorkerRegistration> | undefined;
let applying = false;
const changed = () => dispatchEvent(new Event('p-note:pwa'));

export const standalone = () => matchMedia('(display-mode: standalone)').matches
  || !!(navigator as Navigator & { standalone?: boolean }).standalone;
export const updateAvailable = () => !!registration?.waiting;

addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); prompt = event as InstallPrompt; changed();
});
addEventListener('appinstalled', () => { prompt = undefined; changed(); });

export async function installPwa(): Promise<boolean> {
  if (!prompt) return false;
  const current = prompt;
  prompt = undefined;
  try { await current.prompt(); await current.userChoice; }
  finally { changed(); }
  return true;
}

export function registerPwa(): Promise<ServiceWorkerRegistration> {
  registering ??= navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((value) => {
    registration = value;
    const check = () => {
      changed();
      value.installing?.addEventListener('statechange', changed);
    };
    value.addEventListener('updatefound', check);
    check();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applying) location.reload();
    });
    // 休眠回來時檢查新版；離線或檢查失敗不打斷筆記。
    addEventListener('online', () => { void value.update().catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void value.update().catch(() => {});
    });
    return value;
  }).catch((failure) => { registering = undefined; throw failure; });
  return registering;
}

export async function applyPwaUpdate(): Promise<void> {
  if (applying || !registration?.waiting) return;
  const editor = window.probe?.editor;
  const editable = editor?.isEditable;
  const inert = document.body.inert;
  document.body.inert = true;
  if (editor) editor.isEditable = false;
  try {
    await saveDraft();
    const waiting = registration.waiting;
    if (!waiting) throw new Error('新版狀態已改變，請重試');
    applying = true;
    waiting.postMessage({ type: 'skip-waiting' });
  } catch (failure) {
    applying = false;
    document.body.inert = inert;
    if (editor) editor.isEditable = editable ?? true;
    throw failure;
  }
}
