-- Project quantities are whole parts (projects-preparation-plan.md §3.3, §11.11).
--
-- 023 gave every project quantity NUMERIC(12,3), matching
-- sub_product_revision_parts.quantity. That was never the rule the application
-- enforced: a BOM line is rounded on write, the pickers only accept whole
-- numbers, every read of it cast ::integer, and stock entries are
-- z.number().int(). Half a part cannot be needed, ordered, received or picked.
--
-- APPLY THIS BEFORE STARTING THE NEW IMAGES, not after. The old code reads the
-- new columns fine; the new code cannot read the old ones — NUMERIC arrives in
-- node as a string, so quantities concatenate instead of adding and the
-- stock-shortfall flag silently reads false. deploy-ssh.sh now migrates before
-- recreating the app containers; the manual path in DEPLOY.md is yours to order.
--
-- WHY THE TEMPORARY CONSTRAINTS BELOW: `ALTER COLUMN ... TYPE INTEGER USING
-- x::integer` does NOT refuse a fractional value, it ROUNDS it (1.5 -> 2),
-- silently rewriting a real BOM line. Each conversion is fronted by a CHECK
-- that fails by name if any row is fractional, and dropped once the type
-- carries the rule. To see it coming, on production:
--   SELECT count(*) FROM sub_product_revision_parts WHERE quantity <> round(quantity);
--   SELECT count(*) FROM stock_entries
--    WHERE quantity <> trunc(quantity) OR quantity_consumed <> trunc(quantity_consumed);
--
-- stock_entries keeps NUMERIC(10,3) and gains a whole-number CHECK instead:
-- available stock feeds from_stock_qty so it must be whole, but changing its
-- type would change how stock reaches the browser, which is the stock module's
-- call. Note an INTEGER column rounds rather than refuses, so the refusal for
-- new data lives at the API boundary (schemas/parts.schema.ts).
--
-- `db:migrate` re-runs every migration with no ledger; every statement here is
-- safe to re-run.
--
-- Run: psql "$DATABASE_URL" -f database/migrations/025-integer-project-quantities.sql

BEGIN;

ALTER TABLE project_parts DROP CONSTRAINT IF EXISTS tmp_chk_025_whole;
ALTER TABLE project_parts ADD CONSTRAINT tmp_chk_025_whole CHECK (
  required_qty = round(required_qty) AND from_stock_qty = round(from_stock_qty)
  AND missing_qty = round(missing_qty) AND ordered_qty = round(ordered_qty)
  AND received_qty = round(received_qty) AND prepared_qty = round(prepared_qty));
ALTER TABLE project_parts
  ALTER COLUMN required_qty   TYPE INTEGER USING required_qty::integer,
  ALTER COLUMN from_stock_qty TYPE INTEGER USING from_stock_qty::integer,
  ALTER COLUMN missing_qty    TYPE INTEGER USING missing_qty::integer,
  ALTER COLUMN ordered_qty    TYPE INTEGER USING ordered_qty::integer,
  ALTER COLUMN received_qty   TYPE INTEGER USING received_qty::integer,
  ALTER COLUMN prepared_qty   TYPE INTEGER USING prepared_qty::integer;
ALTER TABLE project_parts DROP CONSTRAINT tmp_chk_025_whole;

ALTER TABLE project_part_usages DROP CONSTRAINT IF EXISTS tmp_chk_025_whole;
ALTER TABLE project_part_usages ADD CONSTRAINT tmp_chk_025_whole
  CHECK (qty_per_unit = round(qty_per_unit));
ALTER TABLE project_part_usages
  ALTER COLUMN qty_per_unit TYPE INTEGER USING qty_per_unit::integer;
ALTER TABLE project_part_usages DROP CONSTRAINT tmp_chk_025_whole;

ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS tmp_chk_025_whole;
ALTER TABLE order_lines ADD CONSTRAINT tmp_chk_025_whole
  CHECK (quantity = round(quantity) AND received_qty = round(received_qty));
ALTER TABLE order_lines
  ALTER COLUMN quantity     TYPE INTEGER USING quantity::integer,
  ALTER COLUMN received_qty TYPE INTEGER USING received_qty::integer;
ALTER TABLE order_lines DROP CONSTRAINT tmp_chk_025_whole;

-- The one with production data in it, and the one the projects module's
-- required_qty is computed from.
ALTER TABLE sub_product_revision_parts DROP CONSTRAINT IF EXISTS tmp_chk_025_whole;
ALTER TABLE sub_product_revision_parts ADD CONSTRAINT tmp_chk_025_whole
  CHECK (quantity = round(quantity));
ALTER TABLE sub_product_revision_parts
  ALTER COLUMN quantity TYPE INTEGER USING quantity::integer;
ALTER TABLE sub_product_revision_parts DROP CONSTRAINT tmp_chk_025_whole;

ALTER TABLE stock_entries
  DROP CONSTRAINT IF EXISTS chk_stock_entry_quantities_whole;
ALTER TABLE stock_entries
  ADD CONSTRAINT chk_stock_entry_quantities_whole
    CHECK (quantity = trunc(quantity) AND quantity_consumed = trunc(quantity_consumed));

COMMIT;
