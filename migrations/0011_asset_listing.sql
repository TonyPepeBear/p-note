CREATE INDEX IF NOT EXISTS assets_owner_created_idx ON assets(owner_id, created_at DESC, id DESC);
