ALTER TABLE pages ADD COLUMN database_config TEXT;
ALTER TABLE pages ADD COLUMN property_values TEXT NOT NULL DEFAULT '{}';
