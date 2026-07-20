-- Migration 005 — Product & Sub-product types become managed lists instead
-- of free text (see the new Settings page). `products.type` / `sub_products.type`
-- now reference `product_types.name` / `sub_product_types.name` via a FK on
-- the name column (kept UNIQUE), so existing code that treats `type` as a
-- plain string keeps working unchanged.
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/005-add-product-and-sub-product-types.sql
-- (idempotent — safe to re-run)

CREATE TABLE IF NOT EXISTS product_types (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_product_types (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill: turn every distinct value already used by an existing
-- product/sub-product into a real type row, so the FK constraints below
-- don't reject pre-existing data.
INSERT INTO product_types (name)
  SELECT DISTINCT type FROM products WHERE type IS NOT NULL AND type <> ''
  ON CONFLICT (name) DO NOTHING;

INSERT INTO sub_product_types (name)
  SELECT DISTINCT type FROM sub_products WHERE type IS NOT NULL AND type <> ''
  ON CONFLICT (name) DO NOTHING;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_type_fkey FOREIGN KEY (type)
    REFERENCES product_types (name) ON UPDATE CASCADE;

ALTER TABLE sub_products DROP CONSTRAINT IF EXISTS sub_products_type_fkey;
ALTER TABLE sub_products
  ADD CONSTRAINT sub_products_type_fkey FOREIGN KEY (type)
    REFERENCES sub_product_types (name) ON UPDATE CASCADE;
