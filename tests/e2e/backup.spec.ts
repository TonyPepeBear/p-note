import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import * as Y from 'yjs';
import { openPrivate, saved } from './helpers';
import type { BackupManifest } from '../../src/shared/backup';
import { images } from '../fixtures/images';

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
});
test('BACKUP-06：設定頁建立成功備份並下載完整 ZIP，正文與圖片可解析且憑證不在匯出', async ({ page }, info) => {
  const id = await openPrivate(page);
  await page.evaluate(() => { const editor = window.probe!.editor; editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '匯出中文日記與程式碼' }, { type: 'codeBlock', props: { language: 'javascript' }, content: 'const note = "日記";\n  note;' }]); });
  await saved(page);
  await page.getByLabel('圖片檔案', { exact: true }).setInputFiles({ name: '原圖.png', mimeType: 'image/png', buffer: Buffer.from(images.png) });
  await page.getByRole('button', { name: '上傳圖片', exact: true }).click(); await expect(page.locator('.bn-block-content[data-content-type="image"]')).toHaveCount(1); await saved(page);
  await expect(page.getByRole('button', { name: '備份設定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '備份設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '備份設定', exact: true })).toBeVisible();
  await expect(page.locator('.tiptap')).toBeHidden();
  await page.getByRole('button', { name: '建立備份', exact: true }).click();
  const link = page.getByRole('link', { name: '下載 ZIP', exact: true }); await expect(link).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const path = info.outputPath('complete-backup.zip'); await download.saveAs(path); expect(await download.failure()).toBeNull();
  const bytes = await readFile(path); const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  const files = new Map<string, Uint8Array>();
  for (const entry of await reader.getEntries()) if (!entry.directory) files.set(entry.filename, await entry.getData(new Uint8ArrayWriter(), { checkSignature: true }));
  await reader.close(); const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as BackupManifest;
  expect([...files.keys()].sort()).toEqual(['manifest.json', ...manifest.pages.map(item => item.file.path), ...manifest.assets.map(item => item.file.path)].sort());
  const row = manifest.pages.find(item => item.metadata.id === id)!; const doc = new Y.Doc(); Y.applyUpdate(doc, files.get(row.file.path)!);
  expect(doc.getXmlFragment('body').toString()).toContain('匯出中文日記與程式碼'); expect(doc.getXmlFragment('body').toString()).toContain('const note'); doc.destroy();
  for (const item of [...manifest.pages, ...manifest.assets]) expect(createHash('sha256').update(files.get(item.file.path)!).digest('hex')).toBe(item.file.checksum);
  expect(files.get(manifest.assets[0].file.path)).toEqual(images.png);
  expect(bytes.toString()).not.toMatch(/test-only-secret|verification|accessToken|refreshToken/);
  const owner = await (await page.request.get('/api/session')).json(); expect(manifest.owner.id).toBe(owner.user.id);
  await page.getByRole('button', { name: '返回編輯', exact: true }).click(); await expect(page.getByTestId('ready')).toHaveText('可編輯'); await saved(page);
});

test('BACKUP-08：設定頁在清空產品儲存後恢復日記正文／原圖與索引', async ({ page }) => {
  const id = await openPrivate(page);
  await page.evaluate(() => { const editor = window.probe!.editor; editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '從完整備份恢復的日記' }]); }); await saved(page);
  await page.getByLabel('圖片檔案', { exact: true }).setInputFiles({ name: '原圖.png', mimeType: 'image/png', buffer: Buffer.from(images.png) });
  await page.getByRole('button', { name: '上傳圖片', exact: true }).click(); await expect(page.locator('.bn-block-content[data-content-type="image"]')).toHaveCount(1); await saved(page);
  await page.getByRole('button', { name: '備份設定', exact: true }).click(); await page.getByRole('button', { name: '建立備份', exact: true }).click();
  await expect(page.getByRole('button', { name: '選擇還原', exact: true })).toHaveCount(1);
  expect((await page.request.post('/__test/clear-product')).status()).toBe(200);
  await page.getByRole('button', { name: '選擇還原', exact: true }).click();
  await page.getByLabel('我知道將以備份覆蓋目前頁面', { exact: true }).check();
  await page.getByRole('button', { name: '覆蓋還原', exact: true }).click();
  await expect(page.getByTestId('ready')).toHaveText('可編輯', { timeout: 15000 }); await saved(page);
  expect(new URL(page.url()).searchParams.get('page')).toBe(id);
  await expect(page.locator('.tiptap')).toContainText('從完整備份恢復的日記');
  const image = await page.evaluate(() => window.probe!.editor.document.find(block => block.type === 'image')!);
  const response = await page.request.get(image.props.url); expect(response.status()).toBe(200); expect(new Uint8Array(await response.body())).toEqual(images.png);
  const search = await (await page.request.get('/api/search?q=' + encodeURIComponent('完整備份恢復'))).json(); expect(search.map((row: { id: string }) => row.id)).toContain(id);
});
