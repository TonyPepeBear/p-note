ALTER TABLE page_search ADD COLUMN linked_pages TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(linked_pages));
