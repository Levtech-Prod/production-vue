-- Migration 014 — every sub-product must belong to a main product.
--
-- Migration 001 added `sub_products.product_id` and backfilled it from revision
-- membership, but left the column nullable: rows that belonged to no product
-- revision at the time could not be derived and stayed NULL.
--
-- The upload tree now nests a sub-product's folder inside its product's
-- (uploads-restructure-plan.md §2), so a parentless sub-product has nowhere to
-- put its files. Enforce what the API has required since `createSubProductSchema`
-- made `productId` mandatory.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/014-require-sub-product-parent.sql
-- (idempotent — safe to re-run)

-- Fail loudly rather than silently deleting data: if any orphan is left, the
-- SET NOT NULL below would error anyway, and this says why.
DO $$
DECLARE
  orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM sub_products WHERE product_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'ERROR: % sub-product(s) have no product_id. Assign or delete them first: SELECT id, name, sku FROM sub_products WHERE product_id IS NULL;',
      orphans;
  END IF;
END $$;

ALTER TABLE sub_products ALTER COLUMN product_id SET NOT NULL;
