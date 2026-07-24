-- Migration 007 — Add `show_as_column` flag to part category parameters.
-- When true, the parameter is rendered as its own dedicated column in the
-- Parts table (placed right after the Name column) instead of being grouped
-- together with the rest of a part's values in the "Other Parameters" cell.
-- Defaults to false so existing parameters keep their current behaviour.
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/007-add-parameter-show-as-column.sql
-- (idempotent — safe to re-run)

ALTER TABLE part_category_parameters
  ADD COLUMN IF NOT EXISTS show_as_column BOOLEAN NOT NULL DEFAULT FALSE;
