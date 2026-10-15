export function oauthReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/oauth/authorize?') || value.length > 8192) return;
  try {
    const url = new URL(value, 'https://return.example.test');
    if (url.origin === 'https://return.example.test' && url.pathname === '/oauth/authorize' && !url.hash) return url.pathname + url.search;
  } catch { /* 格式無效時不接受返回路徑。 */ }
}
