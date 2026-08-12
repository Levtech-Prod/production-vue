-- Migration 018 — where a part physically sits on its sub-product.
--
-- `parts.location` is unrelated and stays as it is: the warehouse spot a part
-- is stocked in, one value per part. This is a property of the BOM LINE, not
-- of the part: the same part can sit on the right of one sub-product and on
-- the left of another, so it cannot live on `parts`.
--
-- Versioned with the rest of the BOM because moving a component is a design
-- change — it shows up in the revision compare and the product change log,
-- and a new revision inherits it from the revision it was duplicated from.
--
-- Named `mount_position`, not `position`: `product_revision_sub_products`
-- already has a `position` column holding a display-order integer, and two
-- columns of the same name meaning different things is a trap.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/018-add-part-mount-position.sql
-- (idempotent — safe to re-run)

ALTER TABLE sub_product_revision_parts
  ADD COLUMN IF NOT EXISTS mount_position VARCHAR(120);
