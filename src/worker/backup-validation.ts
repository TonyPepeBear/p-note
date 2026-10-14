import { readConfig, readValues, validValue } from '../shared/databases';
import type { BackupFile, BackupManifest } from '../shared/backup';
import { validDate } from '../shared/pages';
import { IMAGE_LIMIT, IMAGE_TYPES } from '../shared/image';
import { PageError } from './pages';

function invalid(): never { throw new PageError(503, '備份清單無效，請選擇其他成功備份'); }
const identifier = (value: unknown) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
function file(value: BackupFile, path: string) {
  if (!value || value.path !== path || !integer(value.byte_size) || value.byte_size === 0
    || typeof value.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(value.checksum) || !keys(value, ['path', 'byte_size', 'checksum'])) invalid();
}

export function validateManifest(data: BackupManifest): void {
  if (!data || data.format !== 'p-note-backup' || data.version !== 1 || !identifier(data.id) || !identifier(data.owner?.id)
    || !keys(data, ['format', 'version', 'id', 'owner', 'started_at', 'captured_until', 'completed_at', 'pages', 'assets'])
    || !keys(data.owner, ['id']) || !integer(data.started_at) || !integer(data.captured_until) || !integer(data.completed_at)
    || data.started_at > data.captured_until || data.captured_until > data.completed_at || !Array.isArray(data.pages) || !Array.isArray(data.assets)) invalid();
  const pages = new Map<string, BackupManifest['pages'][number]>(); const dates = new Set<string>();
  for (const item of data.pages) {
    const p = item?.metadata;
    if (!p || !identifier(p.id) || pages.has(p.id) || p.owner_id !== data.owner.id || !identifier(p.sync_generation)
      || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200 || !['note', 'journal'].includes(p.kind)
      || !integer(p.metadata_revision) || !integer(p.created_at) || !integer(p.updated_at) || (p.deleted_at !== null && !integer(p.deleted_at))
      || (p.parent_id !== null && !identifier(p.parent_id)) || !integer(item.checkpoint) || !integer(item.captured_at)
      || item.captured_at < data.started_at || item.captured_at > data.captured_until
      || !keys(item, ['metadata', 'checkpoint', 'captured_at', 'file'])
      || !keys(p, ['id', 'owner_id', 'kind', 'title', 'parent_id', 'journal_date', 'sync_generation', 'metadata_revision', 'created_at', 'updated_at', 'deleted_at', 'database_config', 'property_values'])) invalid();
    try {
      if (p.database_config !== undefined && p.database_config !== null) { if (p.kind !== 'note' || typeof p.database_config !== 'string') invalid(); readConfig(p.database_config); }
      if (p.property_values !== undefined) { if (typeof p.property_values !== 'string') invalid(); readValues(p.property_values); }
    } catch { invalid(); }
    if (p.kind === 'journal') {
      if (p.parent_id !== null || typeof p.journal_date !== 'string' || !validDate(p.journal_date) || dates.has(p.journal_date)) invalid();
      dates.add(p.journal_date);
    } else if (p.journal_date !== null) invalid();
    file(item.file, `pages/${p.id}.yjs`); pages.set(p.id, item);
  }
  const children = new Map<string, string[]>(); const roots: string[] = [];
  for (const { metadata: p } of data.pages) {
    if (p.parent_id === null) roots.push(p.id);
    else {
      if (pages.get(p.parent_id)?.metadata.kind !== 'note') invalid();
      const parent = pages.get(p.parent_id)!.metadata;
      if (parent.database_config) {
        if (p.database_config) invalid();
        const values = readValues(p.property_values);
        for (const field of readConfig(parent.database_config).properties) if (values[field.id] !== undefined && !validValue(field, values[field.id])) invalid();
      }
      const list = children.get(p.parent_id) ?? []; list.push(p.id); children.set(p.parent_id, list);
    }
  }
  for (let index = 0; index < roots.length; index++) for (const child of children.get(roots[index]) ?? []) roots.push(child);
  if (roots.length !== pages.size) invalid();
  const assets = new Set<string>();
  for (const item of data.assets) {
    const a = item?.metadata;
    if (!a || !identifier(a.id) || assets.has(a.id) || a.owner_id !== data.owner.id || typeof a.object_key !== 'string' || !a.object_key.startsWith(data.owner.id + '/')
      || typeof a.original_name !== 'string' || !a.original_name.trim() || a.original_name.length > 255 || /[\x00-\x1f\x7f]/.test(a.original_name)
      || !IMAGE_TYPES.includes(a.mime_type) || !integer(a.byte_size) || a.byte_size === 0 || a.byte_size > IMAGE_LIMIT || !integer(a.created_at)
      || !keys(item, ['metadata', 'file']) || !keys(a, ['id', 'owner_id', 'object_key', 'original_name', 'mime_type', 'byte_size', 'checksum', 'created_at'])) invalid();
    file(item.file, `assets/${a.id}`);
    if (a.byte_size !== item.file.byte_size || a.checksum !== item.file.checksum) invalid(); assets.add(a.id);
  }
}
