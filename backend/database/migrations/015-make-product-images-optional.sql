-- Migration 015 — product and sub-product images are now optional.
--
-- Migration 003 made `products.image` and `sub_products.image` NOT NULL.
-- That's being relaxed: both can now be created/edited without an image.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/015-make-product-images-optional.sql
-- (idempotent — safe to re-run)

ALTER TABLE products ALTER COLUMN image DROP NOT NULL;
ALTER TABLE sub_products ALTER COLUMN image DROP NOT NULL;
