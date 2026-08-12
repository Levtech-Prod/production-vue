-- Migration 017 — a part category decides how its parts are named.
--
-- `part_name_mode = 'custom'`     -> a part's name is whatever the user typed
--                                   (existing behaviour, hence the default).
-- `part_name_mode = 'parameters'` -> the name is generated as
--                                   "<typed text> <category> <col param values>",
--                                   using the parameters flagged show_as_column,
--                                   in sort_order. The typed text is optional.
--
-- `parts.name` keeps holding the resolved display string so every existing
-- reader (sub-products, revisions, exports) is unaffected. `parts.name_prefix`
-- keeps the raw text the user typed, which is what makes regeneration possible
-- after a category rename or a change to which parameters are columns —
-- the prefix is not recoverable from the resolved name.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/017-add-part-name-mode.sql
-- (idempotent — safe to re-run)

ALTER TABLE part_categories
  ADD COLUMN IF NOT EXISTS part_name_mode VARCHAR(20) NOT NULL DEFAULT 'custom';

ALTER TABLE part_categories
  DROP CONSTRAINT IF EXISTS part_categories_part_name_mode_check;
ALTER TABLE part_categories
  ADD CONSTRAINT part_categories_part_name_mode_check
  CHECK (part_name_mode IN ('custom', 'parameters'));

-- Nullable: existing parts have no recorded prefix, and in 'custom' mode it
-- simply mirrors `name`.
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS name_prefix VARCHAR(180);

-- Backfill so editing an existing part doesn't clear its name field.
UPDATE parts SET name_prefix = name WHERE name_prefix IS NULL;
