import { BlockNoteEditor } from '@blocknote/core';
import { blocksToYDoc, yDocToBlocks } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { PageError } from './pages';
import { blockSchema, type AppPartialBlock } from '../shared/block-schema';

export function blockEditor() { return BlockNoteEditor.create({ schema: blockSchema }); }
const invalid = (): never => { throw new PageError(400, '無效區塊 JSON、屬性或圖片引用'); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(k => !keys.includes(k))) invalid(); }
function link(value: unknown) { if (typeof value !== 'string' || !/^(https?:\/\/|mailto:|tel:|ftp:\/\/|\/[^/]|#)/i.test(value)) invalid(); }
export async function validatedBlocks(value: unknown, env: Env, owner: string, editor: ReturnType<typeof blockEditor>, options: { allowSyncedBlocks?: boolean } = {}): Promise<AppPartialBlock[]> {
  let count = 0; const ids = new Set<string>(); const assets = new Set<string>(); const syncedBlocks = new Set<string>();
  function inline(content: unknown, links = true): void {
    if (typeof content === 'string') return;
    if (!Array.isArray(content)) return invalid();
    for (const raw of content) {
      const item = object(raw);
      if (item.type === 'link' && links) { only(item, ['type', 'href', 'content']); link(item.href); inline(item.content, false); }
      else {
        only(item, ['type', 'text', 'styles']); if (item.type !== 'text' || typeof item.text !== 'string') invalid();
        if (item.styles !== undefined) for (const [name, v] of Object.entries(object(item.styles))) {
          const style = editor.schema.styleSchema[name as keyof typeof editor.schema.styleSchema];
          if (!style || typeof v !== style.propSchema) invalid();
        }
      }
    }
  }
  function walk(list: unknown, depth: number) {
    if (!Array.isArray(list) || depth > 20) return invalid();
    for (const raw of list) {
      if (++count > 1000) invalid(); const b = object(raw); only(b, ['id', 'type', 'props', 'content', 'children']);
      if (b.id !== undefined) { if (typeof b.id !== 'string' || !/^[\w-]{1,80}$/.test(b.id) || ids.has(b.id)) invalid(); ids.add(b.id as string); }
      if (typeof b.type !== 'string' || !Object.hasOwn(editor.schema.blockSchema, b.type)) invalid();
      const schema = editor.schema.blockSchema[b.type as keyof typeof editor.schema.blockSchema];
      if (b.props !== undefined) for (const [name, v] of Object.entries(object(b.props))) {
        const prop = (schema.propSchema as Record<string, { default?: unknown; type?: string; values?: readonly unknown[] }>)[name];
        if (!prop || typeof v !== (prop.type ?? typeof prop.default) || (prop.values && !prop.values.includes(v)) || (typeof v === 'number' && !Number.isFinite(v))) invalid();
      }
      if (b.type === 'syncedBlock') {
        if (options.allowSyncedBlocks === false || b.content !== undefined || (b.children !== undefined && (!Array.isArray(b.children) || b.children.length > 0))) invalid();
        const id = b.props ? object(b.props).syncedBlockId : undefined;
        if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) invalid();
        syncedBlocks.add(id as string);
      }
      if (['image', 'file', 'audio', 'video'].includes(b.type as string)) {
        const url = b.props ? object(b.props).url : undefined;
        if (url === undefined || url === '') { /* 編輯器尚未上傳的媒體佔位。 */ }
        else if (typeof url !== 'string') invalid();
        else if (/^\/api\/assets\/[\w-]{1,80}$/.test(url)) assets.add(url.slice('/api/assets/'.length));
        else {
          try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) invalid(); }
          catch { invalid(); }
        }
      }
      if (b.content !== undefined) {
        if (schema.content === 'none') invalid();
        else if (schema.content === 'table') {
          const table = object(b.content); only(table, ['type', 'rows', 'columnWidths', 'headerRows', 'headerCols']);
          if (table.type !== 'tableContent' || !Array.isArray(table.rows) || table.rows.length > 100) invalid();
          if (table.columnWidths !== undefined && (!Array.isArray(table.columnWidths) || table.columnWidths.some(v => v !== undefined && v !== null && (typeof v !== 'number' || v < 0)))) invalid();
          for (const name of ['headerRows', 'headerCols']) if (table[name] !== undefined && (!Number.isInteger(table[name]) || Number(table[name]) < 0)) invalid();
          for (const row of table.rows as unknown[]) {
            const r = object(row); only(r, ['cells']); if (!Array.isArray(r.cells) || r.cells.length > 50) invalid();
            for (const cell of r.cells as unknown[]) {
              if (typeof cell === 'string' || Array.isArray(cell)) inline(cell);
              else { const c = object(cell); only(c, ['type', 'content', 'props']); if (c.type !== 'tableCell') invalid(); inline(c.content); if (c.props !== undefined) { const p = object(c.props); only(p, ['backgroundColor', 'textColor', 'textAlignment', 'colspan', 'rowspan']); for (const [k,v] of Object.entries(p)) if (['colspan','rowspan'].includes(k) ? !Number.isInteger(v) || Number(v) < 1 || Number(v) > 50 : typeof v !== 'string') invalid(); } }
            }
          }
        } else inline(b.content);
      }
      if (b.children !== undefined) walk(b.children, depth + 1);
    }
  }
  walk(value, 0);
  for (const id of assets) if (!await env.DB.prepare('SELECT 1 FROM assets WHERE id = ? AND owner_id = ?').bind(id, owner).first()) invalid();
  for (const id of syncedBlocks) if (!await env.DB.prepare(`SELECT 1 FROM synced_blocks WHERE id = ? AND owner_id = ?
    AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?)`).bind(id, owner, owner).first()) invalid();
  return value as AppPartialBlock[];
}
export function replaceBlocks(doc: Y.Doc, blocks: AppPartialBlock[], editor: ReturnType<typeof blockEditor>) {
  // 在複製的文件替換 body，保留原 Yjs 歷史；成功落盤前不觸碰在線文件。
  const source = blocksToYDoc(editor, blocks.length ? blocks : [{ type: 'paragraph', content: '' }], 'body');
  try { const body = doc.getXmlFragment('body'); doc.transact(() => { body.delete(0, body.length); body.insert(0, source.getXmlFragment('body').toArray().map(node => { if (!(node instanceof Y.XmlElement) && !(node instanceof Y.XmlText)) return invalid(); return node.clone(); })); }); }
  catch { invalid(); } finally { source.destroy(); }
}
export function readBlocks(doc: Y.Doc, editor: ReturnType<typeof blockEditor>) {
  const fragment = doc.getXmlFragment('body');
  if (!fragment.length) return [];
  try {
    // 先檢查原始 XML；BlockNote 轉換會忽略未知節點，不能將遺失內容當作成功讀取。
    editor.pmSchema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(fragment)).check();
    return yDocToBlocks(editor, doc, 'body');
  } catch { return invalid(); }
}
