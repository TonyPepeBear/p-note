import { ZipWriter, TextReader, Uint8ArrayReader } from '@zip.js/zip.js';
import type { BackupManifest } from '../shared/backup';
import { readFile } from './backups';

export async function exportBackup(env: Env, manifest: BackupManifest, ctx?: ExecutionContext): Promise<Response> {
  const prefix = `${manifest.owner.id}/${manifest.id}/`;
  const files = [...manifest.pages, ...manifest.assets].map(item => item.file);
  // 回應成功前逐檔校驗；串流時再次讀取並驗證，不保留整站二進位資料。
  for (const file of files) await readFile(env, prefix, file);
  let controller!: TransformStreamDefaultController<Uint8Array>;
  const stream = new TransformStream<Uint8Array, Uint8Array>({ start(value) { controller = value; } });
  const writer = new ZipWriter(stream.writable, { useWebWorkers: false, level: 0, zip64: true, bufferedWrite: false });
  const writing = (async () => {
    await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)));
    for (const file of files) await writer.add(file.path, new Uint8ArrayReader(await readFile(env, prefix, file)));
    await writer.close();
  })().catch(() => { controller.error(new Error('備份下載中斷，請重新下載')); });
  if (ctx) ctx.waitUntil(writing); else void writing;
  return new Response(stream.readable, { headers: {
    'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="p-note-${manifest.id}.zip"`,
  } });
}
