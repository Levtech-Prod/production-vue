-- Migration 003 — Type and Image are now required for products and
-- sub-products (previously optional).
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/003-require-product-type-and-image.sql
-- (idempotent — safe to re-run)

-- Backfill existing rows that predate this requirement so the NOT NULL
-- constraints below don't fail. `type` gets a visible placeholder so it's
-- obviously in need of a real value; `image` has no sensible placeholder
-- (no default image asset exists), so it's backfilled with '' — an empty
-- string satisfies NOT NULL while leaving the UI's "no image" state intact
-- for these legacy rows until someone edits them.
UPDATE products SET type = 'Unspecified' WHERE type IS NULL OR type = '';
UPDATE products SET image = '' WHERE image IS NULL;
UPDATE sub_products SET type = 'Unspecified' WHERE type IS NULL OR type = '';
UPDATE sub_products SET image = '' WHERE image IS NULL;

ALTER TABLE products ALTER COLUMN type SET NOT NULL;
ALTER TABLE products ALTER COLUMN image SET NOT NULL;
ALTER TABLE sub_products ALTER COLUMN type SET NOT NULL;
ALTER TABLE sub_products ALTER COLUMN image SET NOT NULL;
