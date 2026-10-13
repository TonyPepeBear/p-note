export type PageRow = {
  id: string; owner_id: string; kind: 'note' | 'journal'; title: string;
  parent_id: string | null; journal_date: string | null; sync_generation: string;
  metadata_revision: number; created_at: number; updated_at: number; deleted_at: number | null;
};
export type PageInfo = PageRow & { room: string; ancestors?: PageRow[]; summary?: string };

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function today(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
