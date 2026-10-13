CREATE TABLE IF NOT EXISTS restore_operations (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE REFERENCES user(id),
  backup_id TEXT NOT NULL REFERENCES backups(id), rollback_id TEXT REFERENCES backups(id),
  phase TEXT NOT NULL CHECK(phase IN ('pausing', 'paused', 'preparing', 'resuming')),
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS restore_members (
  operation_id TEXT NOT NULL REFERENCES restore_operations(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL, generation TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('old', 'new')),
  PRIMARY KEY(operation_id, page_id, kind)
);
CREATE TABLE IF NOT EXISTS completed_restores (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id),
  backup_id TEXT NOT NULL, rollback_id TEXT NOT NULL, completed_at INTEGER NOT NULL
);
