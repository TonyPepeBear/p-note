CREATE TABLE IF NOT EXISTS synced_blocks (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id),
  sync_generation TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(id, owner_id)
);
CREATE TABLE IF NOT EXISTS page_synced_blocks (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  synced_block_id TEXT NOT NULL REFERENCES synced_blocks(id),
  PRIMARY KEY(page_id, synced_block_id)
);
CREATE INDEX IF NOT EXISTS page_synced_blocks_block_idx ON page_synced_blocks(synced_block_id);
CREATE TABLE IF NOT EXISTS synced_block_search (
  synced_block_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, plain_text TEXT NOT NULL,
  linked_pages TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(linked_pages)),
  indexed_generation TEXT NOT NULL, indexed_checkpoint INTEGER NOT NULL,
  FOREIGN KEY(synced_block_id, owner_id) REFERENCES synced_blocks(id, owner_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS restore_synced_block_members (
  operation_id TEXT NOT NULL REFERENCES restore_operations(id) ON DELETE CASCADE,
  synced_block_id TEXT NOT NULL, generation TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('old', 'new')),
  PRIMARY KEY(operation_id, synced_block_id, kind)
);
