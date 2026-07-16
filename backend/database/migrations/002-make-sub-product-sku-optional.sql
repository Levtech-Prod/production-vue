-- Migration 002 — sub-product SKU is now optional.
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/002-make-sub-product-sku-optional.sql
-- (idempotent — safe to re-run)

-- Note: products.sku stays NOT NULL/UNIQUE — this only relaxes the
-- requirement for sub_products. Postgres UNIQUE constraints already permit
-- any number of NULL values, so no constraint change is needed there.
ALTER TABLE sub_products ALTER COLUMN sku DROP NOT NULL;
