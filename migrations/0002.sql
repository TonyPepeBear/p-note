CREATE TABLE IF NOT EXISTS page_operations (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE REFERENCES user(id),
  page_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('delete', 'restore')),
  created_at INTEGER NOT NULL, FOREIGN KEY(page_id, owner_id) REFERENCES pages(id, owner_id)
);
CREATE TABLE IF NOT EXISTS page_operation_members (
  operation_id TEXT NOT NULL REFERENCES page_operations(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL, owner_id TEXT NOT NULL, generation TEXT NOT NULL,
  PRIMARY KEY(operation_id, page_id), FOREIGN KEY(page_id, owner_id) REFERENCES pages(id, owner_id)
);
CREATE INDEX IF NOT EXISTS page_operation_members_page_idx ON page_operation_members(page_id);
