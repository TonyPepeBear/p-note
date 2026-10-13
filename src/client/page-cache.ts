import type { PageInfo } from '../shared/pages';
import { today } from '../shared/pages';

export function rememberPage(page: PageInfo) {
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
    const page = data && JSON.parse(data) as PageInfo | null;
    if (page && page.id === id && page.owner_id === owner && typeof page.sync_generation === 'string'
      && typeof page.title === 'string' && ['note', 'journal'].includes(page.kind)
      && (page.journal_date === null || typeof page.journal_date === 'string')
      && (page.parent_id === null || typeof page.parent_id === 'string')
      && (page.ancestors === undefined || (Array.isArray(page.ancestors)
        && page.ancestors.every(item => item && typeof item.id === 'string' && typeof item.title === 'string' && item.owner_id === owner)))) return page;
  } catch { /* 損毀或不可用的索引不能冒充已下載頁面。 */ }
  throw new Error('此頁尚未下載，請連線後再開啟');
}
