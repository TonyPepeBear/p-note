import { configured } from './auth';

export async function sendLoginMail(env: Env, email: string, link: string) {
  const sender = env.SENDER_EMAIL;
  const url = new URL(link);
  if (!configured(env) || !env.EMAIL || typeof sender !== 'string' || sender.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)
    || email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()
    || url.origin !== env.BETTER_AUTH_URL || url.pathname !== '/login/confirm'
    || !/^[A-Za-z]{32}$/.test(url.searchParams.get('token') ?? '')) throw new Error('寄信設定或登入連結無效');
  const escaped = url.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const result = await env.EMAIL.send({
    to: email, from: { email: sender, name: 'p-note' }, subject: '登入 p-note',
    text: `請開啟以下連結並按下「確認登入」。連結有效 10 分鐘，只能使用一次。\n\n${url}\n\n若你沒有申請登入，請忽略此郵件。`,
    html: `<p>請按下連結並在網站確認登入。連結有效 10 分鐘，只能使用一次。</p><p><a href="${escaped}">確認登入 p-note</a></p><p>若你沒有申請登入，請忽略此郵件。</p>`,
  });
  if (!result?.messageId) throw new Error('寄信服務未接受郵件');
}
