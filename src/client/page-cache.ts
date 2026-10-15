import type { PageInfo } from '../shared/pages';
import { today } from '../shared/pages';
import { isPageIcon } from '../shared/page-icon';

export function rememberPage(page: PageInfo) {
  const previous = readPage(localStorage.getItem(`p-note:page:${page.owner_id}:${page.id}`), page.owner_id, page.id);
  if (previous?.sync_generation === page.sync_generation && previous.metadata_revision > page.metadata_revision) return;
  if (previous) localStorage.setItem(`p-note:scope:${previous.owner_id}:${previous.id}:${previous.sync_generation}`, JSON.stringify(previous));
  localStorage.setItem(`p-note:scope:${page.owner_id}:${page.id}:${page.sync_generation}`, JSON.stringify(page));
  localStorage.setItem(`p-note:page:${page.owner_id}:${page.id}`, JSON.stringify(page));
  if (page.kind === 'journal') localStorage.setItem(`p-note:date:${page.owner_id}:${page.journal_date}`, page.id);
  localStorage.setItem('p-note:owner', page.owner_id);
}
export function cachedPage(id?: string): PageInfo {
  try {
    const owner = localStorage.getItem('p-note:owner');
    id ??= localStorage.getItem(`p-note:date:${owner}:${today(Date.now())}`) ?? undefined;
    const data = owner && id && localStorage.getItem(`p-note:page:${owner}:${id}`);
    const page = owner && id && readPage(data || null, owner, id);
    if (page) return page;
  } catch { /* 損毀或不可用的索引不能冒充已下載頁面。 */ }
  throw new Error('此頁尚未下載，請連線後再開啟');
}

export function cachedVersions(current: PageInfo): PageInfo[] {
  const prefix = `p-note:scope:${current.owner_id}:${current.id}:`; const versions: PageInfo[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const page = readPage(localStorage.getItem(key), current.owner_id, current.id);
    if (page && key === prefix + page.sync_generation && page.sync_generation !== current.sync_generation) versions.push(page);
  }
  return versions;
}

function readPage(data: string | null, owner: string, id: string): PageInfo | undefined {
  try {
    const page = data && JSON.parse(data) as PageInfo | null;
    if (page && page.id === id && page.owner_id === owner && typeof page.sync_generation === 'string'
      && typeof page.title === 'string' && ['note', 'journal'].includes(page.kind)
      && (page.icon === undefined || isPageIcon(page.icon))
      && (page.journal_date === null || typeof page.journal_date === 'string')
      && (page.parent_id === null || typeof page.parent_id === 'string')
      && (page.ancestors === undefined || (Array.isArray(page.ancestors)
        && page.ancestors.every(item => item && typeof item.id === 'string' && typeof item.title === 'string' && item.owner_id === owner
          && (item.icon === undefined || isPageIcon(item.icon)))))) return { ...page, icon: page.icon ?? null };
  } catch { /* 損毀的本機 metadata 不得用來開啟其他文件。 */ }
}
