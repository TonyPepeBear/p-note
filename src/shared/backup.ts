import type { PageRow } from './pages';

export type BackupFile = { path: string; byte_size: number; checksum: string };
export type AssetRow = { id: string; owner_id: string; object_key: string; original_name: string; mime_type: string; byte_size: number; checksum: string; created_at: number };
// 早期同版本清單尚未包含 icon；還原時將缺值視為 null。
export type BackupPageRow = Omit<PageRow, 'icon'> & { icon?: string | null };
export type BackupManifest = {
  format: 'p-note-backup'; version: 1; id: string; owner: { id: string }; started_at: number; captured_until: number; completed_at: number;
  pages: { metadata: BackupPageRow; checkpoint: number; captured_at: number; file: BackupFile }[];
  assets: { metadata: AssetRow; file: BackupFile }[];
};
export type BackupCatalog = { id: string; status: 'pending' | 'success' | 'failed' | 'expiring'; started_at: number; completed_at: number | null; error: string | null };
