-- Sub-product preparation (projects-preparation-plan.md §11.13, §11.14).
--
-- Preparation happens one SUB-PRODUCT at a time, so the board's *Preparation*
-- column shows one card per sub-product of every product a project builds,
-- each opening the pick list of parts behind it. Three changes, one feature:
--
--   1. `project_sub_product_preparations` — WHICH sub-products are prepared.
--   2. `project_part_usages.picked_qty` — the pick list that has to be
--      complete before one can be.
--   3. `idx_project_parts_part_id` loses its WHERE clause, because the
--      cross-project "reserved" aggregate loses its `prepared_qty` term.
--
-- Same conventions as the rest of the schema: SERIAL PK, no triggers, no
-- functions. Mirrored into schema.sql in the same change.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/026-add-sub-product-preparation.sql
-- (idempotent — safe to re-run)

-- ===========================================================================
-- 1. Which sub-products are prepared
-- ===========================================================================
-- The fact nothing in 023 could record. `project_parts.prepared_qty` cannot
-- say it — a part fitted in two sub-products of the same product is ONE
-- `project_parts` row, so its prepared quantity cannot name which of the two
-- consumed it.
--
-- Sparse: a row exists only for a sub-product that IS prepared. Marking one
-- adds its parts' quantities to `project_parts.prepared_qty` in the same
-- transaction; un-marking subtracts exactly the same amounts. The quantities
-- are deliberately NOT stored here — they are always re-derivable as
-- `project_part_usages.qty_per_unit x project_products.quantity`, and a stored
-- copy is one more thing that can drift from the rows it summarises.
--
-- The set of sub-products a project HAS is not stored either: it is the
-- distinct (project_product_id, sub_product_revision_id) pairs of
-- `project_part_usages`, frozen at Start. A sub-product revision carrying no
-- parts therefore has no card, which is the same thing the frozen BOM already
-- says about it — there is nothing to prepare.

CREATE TABLE IF NOT EXISTS project_sub_product_preparations (
  id                      SERIAL PRIMARY KEY,
  -- Which product-IN-THE-PROJECT, not which product: the same product pinned
  -- at two revisions is two sets of sub-products, prepared independently.
  project_product_id      INTEGER NOT NULL REFERENCES project_products(id) ON DELETE CASCADE,
  -- No ON DELETE clause, like project_part_usages: a revision a project has
  -- already prepared cannot be deleted out from under it.
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id),
  prepared_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prepared_by             INTEGER REFERENCES users(id),
  -- Also the lookup index the board's per-sub-product read uses; a separate
  -- index on project_product_id would duplicate this one's prefix.
  UNIQUE (project_product_id, sub_product_revision_id)
);

-- ===========================================================================
-- 2. The pick list behind one card
-- ===========================================================================
-- Marking a whole sub-product prepared is the commit; this is the checklist
-- that has to be complete before it. The grain is already right and needs no
-- new table: `project_part_usages` is exactly one row per (product-in-the-
-- project, sub-product revision, part), which is one line of one pick list.
--
-- A QUANTITY, not a tick. A line routinely needs 5 and the shelf holds 2, with
-- the other 3 on order: those 2 get pulled into the job box now and the line is
-- finished when the rest arrive. A boolean cannot say that, and the number is
-- the whole point of saying it.
--
-- `picked_qty` is the source of truth for what has been set aside, and
-- `project_parts.prepared_qty` is its sum across that part's usage rows,
-- maintained in the same transaction as every pick. That is what makes
-- `chk_project_parts_prepared_within_pickable` do the work for free: a pick
-- can never exceed what the project actually holds, because the sum would
-- break the CHECK. The per-line ceiling — qty_per_unit x the product's project
-- quantity — spans two tables and so is enforced in the API instead.
--
-- One column, not three: who pulled the parts and when is already recorded,
-- once and where it matters, on the preparation row that says the sub-product
-- was finished. A timestamp per checkbox would be a column nothing reads.
--
-- No index: every read of it is already filtered to one project's usage rows
-- by the indexes 023 created.

ALTER TABLE project_part_usages
  ADD COLUMN IF NOT EXISTS picked_qty INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_project_part_usages_picked_non_negative CHECK (picked_qty >= 0);

-- An unreleased draft of this migration made the pick a tick (picked_at /
-- picked_by) before the partial case came up. Dropped here so a database that
-- ran that draft ends up with the same structure as a fresh one.
ALTER TABLE project_part_usages
  DROP COLUMN IF EXISTS picked_at,
  DROP COLUMN IF EXISTS picked_by;

-- ===========================================================================
-- 3. "Reserved" stops subtracting prepared_qty
-- ===========================================================================
-- §4.2 subtracted prepared parts because it assumed picking one also consumes
-- it — true only once the Preparation pick list (§7 step 19) writes the
-- `removed` stock_entries that take it out of "available". Marking a
-- sub-product prepared writes no such entry, so subtracting here would drop
-- those parts out of `reserved` while `available` still counted them, and the
-- next project to start would seed `from_stock_qty` from stock already sitting
-- in a box. The term comes back with the pick list that earns it.
--
-- 023's index was partial on exactly that predicate, so it has to lose the
-- WHERE clause with it or it silently stops covering the query.

DROP INDEX IF EXISTS idx_project_parts_part_id;
CREATE INDEX IF NOT EXISTS idx_project_parts_part_id ON project_parts(part_id);
