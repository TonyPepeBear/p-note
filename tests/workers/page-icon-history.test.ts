import { exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { PageVersion, PageVersionPreview, PageVersionRestore } from '../../src/shared/history';
import { blockEditor, replaceBlocks } from '../../src/worker/block-json';
import { authenticated, commit, connect, origin, persisted } from './helpers';
import { create, manifest } from './backup-helpers';

const sockets: WebSocket[] = [];
beforeEach(async () => { await exports.default.fetch(origin + '/__test/reset', { method: 'POST' }); });
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); await reset(); });

async function fixture() {
  const auth = await authenticated(); const page = await auth.note('歷史原標題');
  const client = await connect(page, auth.cookie); sockets.push(client.socket);
  const doc = new Y.Doc(); let count = 0;
  const write = async (text: string) => {
    replaceBlocks(doc, [{ type: 'paragraph', content: text }], blockEditor());
    expect((await commit(client, doc, 'icon-history-' + ++count)).type).toBe('persisted');
    await client.stub.reindex({ owner: page.owner_id, page: page.id, generation: page.sync_generation });
  };
  const icon = async (value: string | null) => {
    expect((await auth.post(`/api/pages/${page.id}/icon`, { icon: value })).status).toBe(200);
  };
  const manual = async () => {
    const response = await auth.post(`/api/pages/${page.id}/history`, {}); expect(response.status).toBe(201);
    return response.json<PageVersion>();
  };
  const restore = (id: string, request_id = crypto.randomUUID()) => auth.post(`/api/pages/${page.id}/history/${id}/restore`, { request_id });
  const preview = async (id: string) => {
    const response = await auth.get(`/api/pages/${page.id}/history/${id}`); expect(response.status).toBe(200);
    return response.json<PageVersionPreview>();
  };
  const content = async (result: PageVersionRestore) => {
    const current = await connect(result.page, auth.cookie); sockets.push(current.socket);
    const document = await persisted(current);
    try { return document.getXmlFragment('body').toString(); } finally { document.destroy(); }
  };
  return { auth, page, doc, write, icon, manual, restore, preview, content };
}

it('ICON-04 HIST-03：單頁歷史還原標題與正文，保留目前圖示；移除後重送及還原前態不復活圖示', async () => {
  const f = await fixture();
  try {
    await f.icon('📘'); await f.write('歷史中的較早正文'); const old = await f.manual();
    await f.icon('🚀');
    expect((await f.auth.post(`/api/pages/${f.page.id}/title`, { title: '目前的新標題' })).status).toBe(200);
    await f.write('還原前的最新正文');
    const request = crypto.randomUUID(); const restored = await f.restore(old.id, request); expect(restored.status).toBe(200);
    const result = await restored.json<PageVersionRestore>();
    expect(result.page).toMatchObject({ title: f.page.title, icon: '🚀' });
    expect(result.page.sync_generation).not.toBe(f.page.sync_generation);
    expect(await f.content(result)).toContain('歷史中的較早正文');
    const before = await f.preview(result.before_version_id);
    expect(before.version.title).toBe('目前的新標題');
    expect(JSON.stringify(before.blocks)).toContain('還原前的最新正文');
    await f.icon(null); await abortAllDurableObjects();
    const repeated = await f.restore(old.id, request); expect(repeated.status).toBe(200);
    expect((await repeated.json<PageVersionRestore>()).page).toMatchObject({ icon: null, sync_generation: result.page.sync_generation });
    const undo = await f.restore(result.before_version_id); expect(undo.status).toBe(200);
    const undone = await undo.json<PageVersionRestore>();
    expect(undone.page).toMatchObject({ title: '目前的新標題', icon: null });
    expect(await f.content(undone)).toContain('還原前的最新正文');
  } finally { f.doc.destroy(); }
}, 30000);

it('ICON-04 HIST-06：整站備份還原保留圖示與單頁歷史，其後歷史還原繼續保留圖示', async () => {
  const f = await fixture();
  try {
    await f.write('可跨整站還原的歷史正文'); const old = await f.manual();
    await f.icon('🗂️');
    expect((await f.auth.post(`/api/pages/${f.page.id}/title`, { title: '整站備份標題' })).status).toBe(200);
    await f.write('整站備份中的正文'); const backup = await create(f.auth);
    expect((await manifest(f.auth, backup.id)).pages.find(item => item.metadata.id === f.page.id)!.metadata.icon).toBe('🗂️');
    await f.icon('🌱');
    const restored = await f.auth.post(`/api/backups/${backup.id}/restore`, { request_id: crypto.randomUUID() }); expect(restored.status).toBe(200);
    expect(await f.auth.result(f.auth.get(`/api/pages/${f.page.id}`))).toMatchObject({ title: '整站備份標題', icon: '🗂️' });
    expect(JSON.stringify((await f.preview(old.id)).blocks)).toContain('可跨整站還原的歷史正文');
    const historical = await f.restore(old.id); expect(historical.status).toBe(200);
    const result = await historical.json<PageVersionRestore>();
    expect(result.page).toMatchObject({ title: f.page.title, icon: '🗂️' });
    expect(await f.content(result)).toContain('可跨整站還原的歷史正文');
  } finally { f.doc.destroy(); }
}, 30000);
