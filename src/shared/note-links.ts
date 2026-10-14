export function noteLinkId(href: unknown): string | undefined {
  if (typeof href !== 'string') return;
  return /^\/\?page=([\w-]{1,80})$/.exec(href)?.[1];
}
export const noteLinkHref = (id: string) => '/?page=' + encodeURIComponent(id);
export type Backlink = { id: string; title: string; kind: 'note' | 'journal'; journal_date: string | null };
