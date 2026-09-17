-- Migration 027 — the purchase quantity, decided before Start
-- (projects-preparation-plan.md §12).
--
-- 023 froze the buying decision at Start: `project_parts.missing_qty` is
-- seeded to `required_qty - from_stock_qty` and only editable afterwards. Two
-- things are wrong with that in practice. The buyer knows before Start that a
-- reel is 100 and the project needs 63; and parts the shelf already covers
-- still get bought, to top the shelf back up, which a seed of zero can never
-- express. Both are the same missing ability: say what to BUY while the
-- project is still a draft.
--
-- This table is that, and deliberately nothing more:
--
--   draft:    project_draft_part_quantities.missing_qty   (sparse, this table)
--   Start:    ------ copied into ------>  project_parts.missing_qty
--                                         + missing_qty_overridden = TRUE
--   started:  project_parts.missing_qty   (the row is deleted here)
--
-- The number therefore exists in exactly ONE place at any moment. A draft has
-- no `project_parts` row to hold it — its BOM is recomputed from the pinned
-- revisions on every read — and a started project has no use for this table,
-- so Start moves the value across and deletes the row in the same
-- transaction. Nothing has to reconcile two copies, because there are never
-- two.
--
-- SPARSE, and that is the whole storage rule: a row exists only while the
-- typed quantity differs from what the live seed would compute. Typing the
-- seeded number back deletes the row, which is also how an override is undone
-- — see `isDraftOrderQuantityDefault` in services/projectBom.ts. So the table
-- holds decisions, never a copy of a derivable number.
--
-- Same conventions as the rest of the schema: SERIAL PK, CHECK constraints
-- instead of Postgres enums, no triggers or functions. Mirrored into
-- schema.sql in the same change.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/027-draft-purchase-quantities.sql
-- (idempotent — safe to re-run)

BEGIN;

CREATE TABLE IF NOT EXISTS project_draft_part_quantities (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- `parts.id`, NOT `project_parts.id`. A draft has no project_parts row, and
  -- `PATCH /api/projects/:id` replaces the whole pinned product set — deleting
  -- every project_products row and re-inserting it — so anything keyed on that
  -- side is destroyed by an ordinary edit. The part is the only stable key a
  -- draft has.
  --
  -- ON DELETE CASCADE, unlike project_parts.part_id, which has no ON DELETE
  -- clause at all: a frozen project's claim must block deleting the part, but
  -- a draft's typed quantity is a note, not a claim, and should not be able to
  -- make a part undeletable.
  part_id     INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  -- Whole parts, matching project_parts.missing_qty since migration 025. Zero
  -- is a real value and distinct from an absent row: "buy none of this even
  -- though the shelf is short" is a decision, and the absent row is "no
  -- decision, follow the seed".
  missing_qty INTEGER NOT NULL CHECK (missing_qty >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Also the lookup index every read uses (always by project, sometimes by
  -- part within it); a separate index on project_id would duplicate this
  -- one's prefix.
  UNIQUE (project_id, part_id)
);

COMMIT;
