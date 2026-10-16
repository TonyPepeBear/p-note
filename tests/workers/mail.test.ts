import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handle } from '../../src/worker/app';
import { sendLoginMail } from '../../src/worker/mail';
import { origin } from './helpers';

beforeEach(async () => {
  await exports.default.fetch(origin + '/health');
  await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
});
afterEach(async () => { await reset(); });

function mailEnv() {
  const send = vi.fn(async (_message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> => ({ messageId: 'isolated-message-id' }));
  return { send, configured: { ...env, SENDER_EMAIL: 'noreply@example.test', EMAIL: { send } } };
}
const login = (configured: Env, email = 'owner@example.test') => handle(new Request(origin + '/api/login', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
}), configured);

it('MAIL-01：預設服務以原生 binding 送出可兌換連結與繁體中文純文字／HTML，不回傳憑證', async () => {
  const { send, configured } = mailEnv();
  const response = await login(configured);
  expect(response.status).toBe(200);
  expect(send).toHaveBeenCalledTimes(1);
  const message = send.mock.calls[0][0] as EmailMessageBuilder;
  expect(message).toMatchObject({ to: 'owner@example.test', from: { email: 'noreply@example.test', name: 'p-note' }, subject: '登入 p-note' });
  expect(message.text).toContain('10 分鐘');
  const url = message.text!.match(/http[^\s]+/)![0];
  expect(new URL(url).origin).toBe(origin); expect(new URL(url).pathname).toBe('/login/confirm');
  expect(message.html).toContain(url); expect(message.html).toContain('確認登入');
  const token = new URL(url).searchParams.get('token');
  expect(token).toMatch(/^[A-Za-z]{32}$/);
  expect(await response.text()).not.toMatch(/token|isolated-message-id/);
  expect(JSON.stringify((await env.DB.prepare('SELECT * FROM verification').all()).results)).not.toContain(token);
  const confirmed = await handle(new Request(origin + '/api/confirm', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }), configured);
  expect(confirmed.status).toBe(200); expect(confirmed.headers.has('set-cookie')).toBe(true);
});

it('MAIL-02：原生服務拒絕或未提供接受識別時撤銷連結、回傳一致公開訊息且不洩漏密鑰', async () => {
  for (const rejected of [true, false]) {
    await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
    const { send, configured } = mailEnv();
    if (rejected) send.mockRejectedValue(new Error('E_SENDER_NOT_VERIFIED secret-sensitive-token'));
    else send.mockResolvedValue({ messageId: '' });
    const response = await login(configured);
    expect(response.status).toBe(200); expect(send).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toMatch(/secret|token|E_SENDER|noreply/);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM verification').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM session').first('n')).toBe(0);
  }
});

it('MAIL-03：缺少 binding／寄件地址及非法地址不寄信，也不留下可用連結', async () => {
  for (const address of ['', 'invalid', 'sender@example.test\r\nBcc: other@example.test']) {
    await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
    const { send, configured } = mailEnv();
    const response = await login({ ...configured, SENDER_EMAIL: address });
    expect(response.status).toBe(200); expect(send).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM verification').first('n')).toBe(0);
  }
  await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
  const { configured } = mailEnv();
  const response = await login({ ...configured, EMAIL: undefined } as unknown as Env);
  expect(response.status).toBe(200);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM verification').first('n')).toBe(0);
});

it('MAIL-04：非允許收件人不呼叫 binding，回覆與允許帳號一致', async () => {
  const { send, configured } = mailEnv();
  const other = await login(configured, 'stranger@example.test');
  expect(other.status).toBe(200); expect(send).not.toHaveBeenCalled();
  const owner = await login(configured);
  expect(owner.status).toBe(200); expect(await other.text()).toBe(await owner.text());
  expect(send).toHaveBeenCalledTimes(1);
});

it('MAIL-05：adapter 拒絕其他收件人／外部連結／非法 token，HTML 連結正確編碼', async () => {
  const { send, configured } = mailEnv();
  const token = 'a'.repeat(32);
  const link = `${origin}/login/confirm?token=${token}`;
  await expect(sendLoginMail(configured, 'stranger@example.test', link)).rejects.toThrow();
  for (const url of [link.replace(origin, 'https://external.example.test'), `${origin}/?token=${token}`, link.replace(token, 'invalid')]) {
    await expect(sendLoginMail(configured, 'owner@example.test', url)).rejects.toThrow();
  }
  expect(send).not.toHaveBeenCalled();
  await sendLoginMail(configured, 'owner@example.test', link + '&label=%22test%22');
  const message = send.mock.calls[0][0] as EmailMessageBuilder;
  expect(message.html).toContain('&amp;label='); expect(message.text).toContain('&label=');
});
