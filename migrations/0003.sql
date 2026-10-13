CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id),
  status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'expiring')),
  started_at INTEGER NOT NULL, completed_at INTEGER,
  manifest_checksum TEXT, manifest_size INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS backups_owner_idx ON backups(owner_id, completed_at);
