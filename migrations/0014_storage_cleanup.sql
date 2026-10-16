CREATE TABLE IF NOT EXISTS storage_cleanup (
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('asset', 'version', 'room')),
  object_key TEXT NOT NULL,
  not_before INTEGER NOT NULL,
  PRIMARY KEY(kind, object_key)
);
CREATE INDEX IF NOT EXISTS storage_cleanup_due ON storage_cleanup(not_before);
CREATE TABLE IF NOT EXISTS restore_staging (
  operation_id TEXT NOT NULL REFERENCES restore_operations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(operation_id, kind, id)
);
