type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
let prompt: InstallPrompt | undefined;
let registering: Promise<ServiceWorkerRegistration> | undefined;
const changed = () => dispatchEvent(new Event('p-note:pwa'));

export const standalone = () => matchMedia('(display-mode: standalone)').matches
  || !!(navigator as Navigator & { standalone?: boolean }).standalone;

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
    // 休眠回來時檢查新版；離線或檢查失敗不打斷筆記。
    addEventListener('online', () => { void value.update().catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void value.update().catch(() => {});
    });
    return value;
  }).catch((failure) => { registering = undefined; throw failure; });
  return registering;
}
