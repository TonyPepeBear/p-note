import type { PageRow } from './pages';
import type { SyncedBlockRow } from './synced-blocks';

export type BackupFile = { path: string; byte_size: number; checksum: string };
export type AssetRow = { id: string; owner_id: string; object_key: string; original_name: string; mime_type: string; byte_size: number; checksum: string; created_at: number };
export type BackupManifest = {
  format: 'p-note-backup'; version: 1; id: string; owner: { id: string }; started_at: number; captured_until: number; completed_at: number;
  pages: { metadata: PageRow; checkpoint: number; captured_at: number; file: BackupFile }[];
  // 舊版備份省略這兩個欄位，還原時視為空集合。
  synced_blocks?: { metadata: SyncedBlockRow; checkpoint: number; captured_at: number; file: BackupFile }[];
  page_synced_blocks?: { page_id: string; synced_block_id: string }[];
  assets: { metadata: AssetRow; file: BackupFile }[];
};
export type BackupCatalog = { id: string; status: 'pending' | 'success' | 'failed' | 'expiring'; started_at: number; completed_at: number | null; error: string | null };
