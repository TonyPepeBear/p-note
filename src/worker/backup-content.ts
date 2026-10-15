import * as Y from 'yjs';
import type { BackupManifest } from '../shared/backup';
import { PageError } from './pages';

const invalid = (): never => { throw new PageError(503, '備份同步區塊或引用關係無效'); };
function fenceLength(text: string, minimum: number): number {
  let length = minimum;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  return length;
}

export function backupDocument(bytes: Uint8Array, syncedBlock = false): Y.Doc {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    for (const node of doc.getXmlFragment('body').createTreeWalker(() => true)) {
      if (!(node instanceof Y.XmlElement) || node.nodeName !== 'syncedBlock') continue;
      const id = node.getAttribute('syncedBlockId');
      if (syncedBlock || typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || node.length) invalid();
      // BlockNote 的 children 是內容節點旁的 blockGroup，不在內容節點內。
      const parent = node.parent;
      if (parent instanceof Y.XmlElement && parent.nodeName === 'blockContainer'
        && parent.toArray().some(child => child instanceof Y.XmlElement && child.nodeName === 'blockGroup' && child.length > 0)) invalid();
    }
    return doc;
  } catch (error) { doc.destroy(); throw error; }
}

export function backupReferences(doc: Y.Doc, page: string): NonNullable<BackupManifest['page_synced_blocks']> {
  const ids = new Set<string>();
  for (const node of doc.getXmlFragment('body').createTreeWalker(() => true)) {
    if (node instanceof Y.XmlElement && node.nodeName === 'syncedBlock') ids.add(node.getAttribute('syncedBlockId')!);
  }
  return [...ids].sort().map(id => ({ page_id: page, synced_block_id: id }));
}

export function verifyBackupReferences(manifest: Pick<BackupManifest, 'synced_blocks' | 'page_synced_blocks'>, actual: NonNullable<BackupManifest['page_synced_blocks']>): void {
  const blocks = new Set((manifest.synced_blocks ?? []).map(block => block.metadata.id));
  const expected = new Set((manifest.page_synced_blocks ?? []).map(ref => `${ref.page_id}/${ref.synced_block_id}`));
  if (expected.size !== actual.length || actual.some(ref => !blocks.has(ref.synced_block_id) || !expected.has(`${ref.page_id}/${ref.synced_block_id}`))) invalid();
}

function inlineText(node: Y.XmlText): string {
  return node.toDelta().map((part: { insert: unknown; attributes?: Record<string, unknown> }) => {
    if (typeof part.insert !== 'string') return '';
    let text = part.insert; const attributes = part.attributes ?? {};
    if (attributes.code) { const fence = '`'.repeat(fenceLength(text, 1)); text = `${fence}${text}${fence}`; }
    if (attributes.bold) text = `**${text}**`;
    if (attributes.italic) text = `*${text}*`;
    if (attributes.strike) text = `~~${text}~~`;
    if (attributes.underline) text = `<u>${text}</u>`;
    const link = attributes.link;
    if (link && typeof link === 'object' && 'href' in link && typeof link.href === 'string') text = `[${text}](${link.href.replaceAll(')', '%29')})`;
    return text;
  }).join('');
}

async function* documentText(bytes: Uint8Array, loadBlock: (id: string) => Promise<Uint8Array>, syncedBlock: boolean): AsyncGenerator<string> {
  const doc = backupDocument(bytes, syncedBlock);
  async function* render(node: Y.XmlElement | Y.XmlText | Y.XmlHook): AsyncGenerator<string> {
    if (node instanceof Y.XmlText) { yield inlineText(node); return; }
    if (!(node instanceof Y.XmlElement)) return invalid();
    if (node.nodeName === 'syncedBlock') {
      const id = node.getAttribute('syncedBlockId')!;
      yield `> 同步區塊：\`${id}\`\n\n`;
      yield* documentText(await loadBlock(id), loadBlock, true);
      yield '\n'; return;
    }
    let before = ''; let after = '';
    switch (node.nodeName) {
      case 'image': yield `![${node.getAttribute('caption') ?? node.getAttribute('name') ?? ''}](${(node.getAttribute('url') ?? '').replace(/^\/api\/assets\//, '../../assets/')})\n\n`; return;
      case 'codeBlock': {
        const content = node.toArray().map(child => child instanceof Y.XmlText ? child.toDelta().map((part: { insert: unknown }) => typeof part.insert === 'string' ? part.insert : '').join('') : invalid()).join('');
        const fence = '`'.repeat(fenceLength(content, 3));
        yield `${fence}${node.getAttribute('language') ?? ''}\n${content}\n${fence}\n\n`; return;
      }
      case 'heading': before = '#'.repeat(Math.min(6, Math.max(1, Number(node.getAttribute('level')) || 1))) + ' '; after = '\n\n'; break;
      case 'bulletListItem': before = '- '; after = '\n'; break;
      case 'numberedListItem': before = '1. '; after = '\n'; break;
      case 'checkListItem': before = `- [${node.getAttribute('checked') === 'true' ? 'x' : ' '}] `; after = '\n'; break;
      case 'paragraph': after = '\n\n'; break;
      case 'tableCell': case 'tableHeader': after = ' | '; break;
      case 'tableRow': before = '| '; after = '\n'; break;
    }
    if (before) yield before;
    for (const child of node.toArray()) yield* render(child);
    if (after) yield after;
  }
  try { for (const node of doc.getXmlFragment('body').toArray()) yield* render(node); }
  finally { doc.destroy(); }
}

// 依 ZIP 的讀取速度逐節點展開；大量重複引用也只同時載入一份共用正文。
export function readableDocument(bytes: Uint8Array, loadBlock: (id: string) => Promise<Uint8Array>, syncedBlock = false, heading = ''): ReadableStream<Uint8Array> {
  async function* chunks() { if (heading) yield heading; yield* documentText(bytes, loadBlock, syncedBlock); }
  const iterator = chunks(); const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value)); }
      catch (error) { controller.error(error); await iterator.return(); }
    },
    async cancel() { await iterator.return(); },
  });
}
