-- Migration 021 — one alternative part per BOM part, per sub-product REVISION.
--
-- Scoped like quantity/unit/mount_position (see migration 018): a link belongs
-- to one revision and is carried forward when a revision is duplicated.
-- Directional — the unique index covers (revision, part_id) only, so A and B
-- may each carry one independently.
--
-- SELF-HEALS AN OLDER SHAPE. This file has been revised repeatedly and
-- `db:migrate` re-runs every migration on every run with no ledger, so it
-- cannot assume a clean database: `CREATE TABLE IF NOT EXISTS` alone would
-- silently skip a table already sitting in an older shape, leaving every query
-- against it failing on a missing column. Step 1 drops such a table (dropping,
-- not altering, releases every index/constraint/sequence name an older version
-- may have used). Rows from pre-one-per-part shapes are NOT kept — neither
-- maps onto one-alternate-per-part without inventing which link to keep.
-- Additive changes take the ALTER route instead and lose nothing.
--
-- Run: psql "$DATABASE_URL" -f database/migrations/021-add-part-alternatives.sql
-- Idempotent, and only ever destructive to an older shape.

BEGIN;

-- 1. Drop an earlier shape, if one is there.
DO $$
BEGIN
  IF to_regclass('part_alternatives') IS NOT NULL
     AND to_regclass('ux_part_alternatives_one_per_part') IS NULL THEN
    DROP TABLE part_alternatives;
  END IF;
END $$;

-- 2. The table.
CREATE TABLE IF NOT EXISTS part_alternatives (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  part_id                 INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  alternate_part_id       INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  -- TRUE = this revision ships with the alternate in the BOM line's place.
  -- The BOM cannot answer this itself: the alternate is a catalog part, not a
  -- BOM row. DEFAULT FALSE is for the backfill below only — the route creates
  -- new links TRUE, so pre-existing rows don't claim a substitution.
  alternate_in_use        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_part_alternatives_not_self CHECK (part_id <> alternate_part_id)
);

-- Added after the table existed, so an earlier database skips the CREATE above
-- and needs this. Additive, so no drop is required.
ALTER TABLE part_alternatives
  ADD COLUMN IF NOT EXISTS alternate_in_use BOOLEAN NOT NULL DEFAULT FALSE;

-- The cardinality rule itself; also the per-revision lookup index.
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_alternatives_one_per_part
  ON part_alternatives(sub_product_revision_id, part_id);

-- Both FKs cascade, so each wants its own index.
CREATE INDEX IF NOT EXISTS idx_part_alternatives_part_id
  ON part_alternatives(part_id);
CREATE INDEX IF NOT EXISTS idx_part_alternatives_alternate_part_id
  ON part_alternatives(alternate_part_id);

COMMIT;
