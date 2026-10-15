import { ZipWriter, TextReader, Uint8ArrayReader } from '@zip.js/zip.js';
import type { BackupManifest } from '../shared/backup';
import { readFile } from './backups';
import { backupDocument, backupReferences, readableDocument, verifyBackupReferences } from './backup-content';

export async function exportBackup(env: Env, manifest: BackupManifest, ctx?: ExecutionContext): Promise<Response> {
  const prefix = `${manifest.owner.id}/${manifest.id}/`;
  const files = [...manifest.pages, ...(manifest.synced_blocks ?? []), ...manifest.assets].map(item => item.file);
  // 回應成功前逐檔校驗；串流時再次讀取並驗證，不保留整站二進位資料。
  const references: NonNullable<BackupManifest['page_synced_blocks']> = [];
  for (const page of manifest.pages) {
    const doc = backupDocument(await readFile(env, prefix, page.file));
    try { references.push(...backupReferences(doc, page.metadata.id)); } finally { doc.destroy(); }
  }
  for (const block of manifest.synced_blocks ?? []) backupDocument(await readFile(env, prefix, block.file), true).destroy();
  for (const asset of manifest.assets) await readFile(env, prefix, asset.file);
  verifyBackupReferences(manifest, references);
  const blocks = new Map((manifest.synced_blocks ?? []).map(block => [block.metadata.id, block]));
  const loadBlock = async (id: string) => {
    const block = blocks.get(id); if (!block) throw new Error('備份同步區塊不存在');
    return readFile(env, prefix, block.file);
  };
  let controller!: TransformStreamDefaultController<Uint8Array>;
  const stream = new TransformStream<Uint8Array, Uint8Array>({ start(value) { controller = value; } });
  const writer = new ZipWriter(stream.writable, { useWebWorkers: false, level: 0, zip64: true, bufferedWrite: false });
  const writing = (async () => {
    await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)));
    for (const file of files) await writer.add(file.path, new Uint8ArrayReader(await readFile(env, prefix, file)));
    for (const page of manifest.pages) await writer.add(`readable/pages/${page.metadata.id}.md`, readableDocument(await readFile(env, prefix, page.file), loadBlock, false, `# ${page.metadata.title}\n\n`));
    for (const block of manifest.synced_blocks ?? []) await writer.add(`readable/synced-blocks/${block.metadata.id}.md`, readableDocument(await loadBlock(block.metadata.id), loadBlock, true, `<!-- 同步區塊 ${block.metadata.id} -->\n`));
    await writer.close();
  })().catch(() => { controller.error(new Error('備份下載中斷，請重新下載')); });
  if (ctx) ctx.waitUntil(writing); else void writing;
  return new Response(stream.readable, { headers: {
    'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="p-note-${manifest.id}.zip"`,
  } });
}
