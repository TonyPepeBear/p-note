import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';

const files = ['plugin.json', 'mcp.json', '.codex-plugin/plugin.json', '.mcp.json', 'skills/p-note/SKILL.md', 'README.md'];
const writer = new ZipWriter(new Uint8ArrayWriter());
for (const file of files) await writer.add(file, new Uint8ArrayReader(await readFile(resolve('plugins/p-note', file))));
const archive = resolve(process.argv[2] || 'dist/p-note-plugin.zip');
await mkdir(dirname(archive), { recursive: true });
await writeFile(archive, await writer.close());
console.log(archive);
