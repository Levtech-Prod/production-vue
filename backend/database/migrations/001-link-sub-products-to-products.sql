-- Migration 001 — link sub-products directly to a main product.
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/001-link-sub-products-to-products.sql
-- (idempotent — safe to re-run)

-- 1. New column: every sub-product belongs to one main product.
ALTER TABLE sub_products
  ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sub_products_product_id ON sub_products(product_id);

-- 2. One-time backfill: derive the owning product from the existing
--    revision membership (any product revision that references one of the
--    sub-product's revisions). If a sub-product is referenced by several
--    products (shouldn't happen in practice), the lowest product id wins.
UPDATE sub_products sp
SET product_id = x.product_id
FROM (
  SELECT DISTINCT ON (spr.sub_product_id)
    spr.sub_product_id,
    pr.product_id
  FROM sub_product_revisions spr
  JOIN product_revision_sub_products prsp ON prsp.sub_product_revision_id = spr.id
  JOIN product_revisions pr ON pr.id = prsp.product_revision_id
  ORDER BY spr.sub_product_id, pr.product_id
) x
WHERE sp.id = x.sub_product_id
  AND sp.product_id IS NULL;

-- 3. Data fix: a product revision must reference at most ONE revision per
--    sub-product. Historical flows could link several (e.g. Rev 1 + Rev 2 of
--    the same sub-product to one product revision) — keep the highest
--    revision number and drop the rest.
DELETE FROM product_revision_sub_products a
USING sub_product_revisions ra,
      product_revision_sub_products b,
      sub_product_revisions rb
WHERE ra.id = a.sub_product_revision_id
  AND b.product_revision_id = a.product_revision_id
  AND rb.id = b.sub_product_revision_id
  AND rb.sub_product_id = ra.sub_product_id
  AND b.id <> a.id
  AND (rb.revision_number > ra.revision_number
       OR (rb.revision_number = ra.revision_number AND rb.id > a.sub_product_revision_id));
