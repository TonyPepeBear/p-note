import type * as Y from 'yjs';

export type SyncedBlockRow = {
  id: string; owner_id: string; sync_generation: string; created_at: number; updated_at: number;
};
export type SyncedBlockReference = { id: string; title: string; kind: 'note' | 'journal' };
export type SyncedBlockInfo = SyncedBlockRow & { room: string; reference_count?: number };

// 只讀取實際區塊節點；同頁重複引用以 ID 去重。
export function syncedBlockIds(fragment: Y.XmlFragment): string[] {
  const ids = new Set<string>();
  for (const node of fragment.createTreeWalker(() => true)) {
    if (node && typeof node === 'object' && 'nodeName' in node && node.nodeName === 'syncedBlock' && 'getAttribute' in node) {
      const id = node.getAttribute('syncedBlockId');
      if (typeof id === 'string' && /^[\w-]{1,80}$/.test(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}
