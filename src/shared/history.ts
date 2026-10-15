import type { PageInfo } from './pages';

export type PageVersionReason = 'auto' | 'manual' | 'before_restore' | 'restore';
export type PageVersion = {
  id: string; page_id: string; title: string; created_at: number;
  reason: PageVersionReason; checkpoint: number;
};
export type PageHistory = {
  versions: PageVersion[]; next_cursor: string | null;
  restore: { request_id: string; version_id: string } | null;
};
export type PageVersionPreview = { version: PageVersion; blocks: unknown[] };
export type PageVersionRestore = { ok: true; page: PageInfo; before_version_id: string };
