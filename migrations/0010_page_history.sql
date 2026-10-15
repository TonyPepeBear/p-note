CREATE TABLE IF NOT EXISTS page_versions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES user(id),
  page_id TEXT NOT NULL, generation TEXT NOT NULL, title TEXT NOT NULL,
  created_at INTEGER NOT NULL, reason TEXT NOT NULL CHECK(reason IN ('auto', 'manual', 'before_restore', 'restore')),
  checkpoint INTEGER NOT NULL, checksum TEXT NOT NULL, byte_size INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS page_versions_page_idx ON page_versions(owner_id, page_id, sequence DESC);
CREATE TABLE IF NOT EXISTS page_history_restores (
  request_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE REFERENCES user(id),
  page_id TEXT NOT NULL, version_id TEXT NOT NULL REFERENCES page_versions(id),
  old_generation TEXT NOT NULL, new_generation TEXT NOT NULL,
  before_version_id TEXT NOT NULL, restored_version_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('pausing', 'capturing', 'preparing', 'switching', 'resuming')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS completed_page_history_restores (
  request_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id),
  page_id TEXT NOT NULL, version_id TEXT NOT NULL, before_version_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);
