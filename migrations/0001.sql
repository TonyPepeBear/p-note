CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL, image TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, expiresAt TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, ipAddress TEXT, userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON session(userId);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT, scope TEXT, password TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_userId_idx ON account(userId);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id),
  kind TEXT NOT NULL CHECK(kind IN ('note', 'journal')), title TEXT NOT NULL,
  parent_id TEXT, journal_date TEXT, sync_generation TEXT NOT NULL,
  metadata_revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER,
  UNIQUE(id, owner_id), UNIQUE(owner_id, journal_date),
  FOREIGN KEY(parent_id, owner_id) REFERENCES pages(id, owner_id),
  CHECK((kind = 'journal' AND journal_date IS NOT NULL AND parent_id IS NULL) OR (kind = 'note' AND journal_date IS NULL)),
  CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages(owner_id, parent_id);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id), object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  checksum TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(id, owner_id)
);
CREATE TABLE IF NOT EXISTS page_search (
  page_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, plain_text TEXT NOT NULL,
  summary TEXT NOT NULL, indexed_generation TEXT NOT NULL, indexed_checkpoint INTEGER NOT NULL,
  FOREIGN KEY(page_id, owner_id) REFERENCES pages(id, owner_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth_requests (email TEXT NOT NULL, ip TEXT NOT NULL, requested_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS auth_requests_email_idx ON auth_requests(email, requested_at);
CREATE INDEX IF NOT EXISTS auth_requests_ip_idx ON auth_requests(ip, requested_at);
