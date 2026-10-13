import { reset, abortAllDurableObjects } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { authenticated, connect, commit, persisted } from './helpers';
afterEach(async () => { await reset(); });
it('EDIT-02：正式房間保存程式碼語言、縮排與換行，重啟往返沒有執行副作用', async () => {
  const auth = await authenticated(); const page = await auth.today(); const client = await connect(page, auth.cookie);
  const source = 'function hello() {\n  console.log("你好");\n}\n';
  const doc = new Y.Doc(); const block = new Y.XmlElement('codeBlock'); block.setAttribute('language', 'javascript');
  const text = new Y.XmlText(); text.insert(0, source); block.insert(0, [text]); doc.getXmlFragment('body').insert(0, [block]);
  expect((await commit(client, doc, 'code')).type).toBe('persisted'); client.socket.close(); await abortAllDurableObjects();
  const restored = await connect(page, auth.cookie);
  const actual = (await persisted(restored)).getXmlFragment('body').get(0) as Y.XmlElement;
  expect(actual.getAttribute('language')).toBe('javascript'); expect(actual.get(0).toString()).toBe(source);
  expect((await auth.post('/api/execute', { source })).status).toBe(404); restored.socket.close();
});
