CREATE TABLE IF NOT EXISTS mcp_grants (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  provider_grant_id TEXT
);
CREATE INDEX IF NOT EXISTS mcp_grants_owner ON mcp_grants(owner_id);
