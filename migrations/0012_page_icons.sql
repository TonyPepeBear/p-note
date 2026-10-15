ALTER TABLE pages ADD COLUMN icon TEXT DEFAULT NULL;

DROP TRIGGER database_revision_update;

CREATE TRIGGER database_revision_update AFTER UPDATE ON pages
WHEN OLD.id IS NOT NEW.id OR OLD.owner_id IS NOT NEW.owner_id
  OR OLD.kind IS NOT NEW.kind OR OLD.title IS NOT NEW.title OR OLD.icon IS NOT NEW.icon
  OR OLD.parent_id IS NOT NEW.parent_id OR OLD.journal_date IS NOT NEW.journal_date
  OR OLD.sync_generation IS NOT NEW.sync_generation OR OLD.metadata_revision IS NOT NEW.metadata_revision
  OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at
  OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.database_config IS NOT NEW.database_config
  OR OLD.property_values IS NOT NEW.property_values
BEGIN
  INSERT INTO database_revisions (page_id, revision)
  SELECT id, 1 FROM pages WHERE database_config IS NOT NULL
    AND (id = NEW.id OR (id = OLD.parent_id AND owner_id = OLD.owner_id)
      OR (id = NEW.parent_id AND owner_id = NEW.owner_id))
  ON CONFLICT(page_id) DO UPDATE SET revision = revision + 1;
END;
