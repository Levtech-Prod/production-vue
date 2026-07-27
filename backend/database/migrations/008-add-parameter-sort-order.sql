-- Migration 008 — Add `sort_order` to part category parameters.
-- Parameters were previously returned ordered by their `id`, so their display
-- order matched insertion order and could not be changed. `sort_order` lets a
-- category's parameters be reordered (via drag-and-drop on the Part Categories
-- page); the Parts table renders its parameter columns in the same order.
-- Existing rows are backfilled by `id` so their current order is preserved.
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/008-add-parameter-sort-order.sql
-- (idempotent — safe to re-run)

ALTER TABLE part_category_parameters
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows so each category's parameters keep their current
-- (id-based) order as their initial sort_order.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY category_id ORDER BY id
  ) - 1 AS position
  FROM part_category_parameters
)
UPDATE part_category_parameters p
SET sort_order = ordered.position
FROM ordered
WHERE p.id = ordered.id;
