-- Migration 004 — Scope product SKU uniqueness to active products.
-- SKUs previously had to be globally unique across all products, including
-- archived ones. That blocked creating a new product (or reactivating an
-- archived one) with the same SKU as a product that's since been archived.
-- SKUs now only need to be unique among *active* products; archived rows
-- fall out of the check entirely.
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/004-scope-product-sku-uniqueness-to-active.sql
-- (idempotent — safe to re-run)

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_active_unique
  ON products (sku) WHERE status = 'active';
