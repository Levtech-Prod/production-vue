-- Migration 021 — give a BOM part one alternative part, scoped to one
-- sub-product REVISION.
--
-- ONE alternate per part per revision, enforced by the unique index on
-- (sub_product_revision_id, part_id) below — not a collection. Replacing a
-- part's alternate is a delete + insert on that pair, which is why the route
-- can treat POST as "set this part's alternate" rather than "add another".
--
-- `alternate_in_use` records which of the two this revision is actually built
-- with; see the column comment below.
--
-- Scoped by sub_product_revision_id (not sub_product_id, and not global on
-- `parts`): a link belongs to exactly one revision, the same way quantity,
-- unit and mount_position (see migration 018) do. Duplicating a revision
-- copies its links forward, same as those fields — after that, each
-- revision's links are edited independently, and a link made on one revision
-- never appears on another, even of the same sub-product.
--
-- Directional: `part_id` is the row being viewed, `alternate_part_id` is what
-- was linked to it. Linking A -> B does NOT make B show A as its alternative;
-- that takes a second, separate link on B's own row. The unique index is on
-- (revision, part_id) alone, so A and B may each carry one independently.
-- `CHECK (part_id <> alternate_part_id)` rules out a part linking to itself.
--
-- CASCADEs on part_id/alternate_part_id (unlike sub_product_revision_parts,
-- which has no ON DELETE and so blocks deleting a part that's actually in a
-- BOM): a stray alternative link isn't a data-integrity risk the way an
-- orphaned BOM line would be, and that BOM protection already stands on its
-- own regardless of what this table does.
--
-- REBUILDS EARLIER SHAPES OF THIS TABLE, DISCARDING THEIR ROWS. This file has
-- been revised twice while the feature was being built — first scoped by
-- sub_product_id with symmetric pairs, then per-revision but allowing several
-- alternates per part. `db:migrate` re-runs every file on every run and keeps
-- no record of what has been applied, so this file cannot assume a clean
-- database: `CREATE TABLE IF NOT EXISTS` on its own silently skips a table
-- already sitting in an older shape, leaving every query against it failing.
-- Step 1 detects an older shape and drops it. Those rows are NOT carried
-- forward — they were same-day test links, and neither earlier shape maps
-- onto "one alternate per part" without inventing a choice about which link
-- to keep (agreed with the user, 2026-08-14).
--
-- Detection is by index name rather than by column: `ux_part_alternatives_
-- one_per_part` exists only in the shape below, so its absence beside an
-- existing table means some earlier shape is in place. A database already on
-- this shape has it, and every step here then no-ops.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/021-add-part-alternatives.sql
-- (idempotent — safe to re-run, and only ever destructive to an older shape)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop an earlier shape, if one is there. No-op on a fresh database and on
--    one already carrying the shape below.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('part_alternatives') IS NOT NULL
     AND to_regclass('ux_part_alternatives_one_per_part') IS NULL THEN
    -- Dropped rather than altered: this releases every index, constraint and
    -- sequence name the old table held, so step 2 builds cleanly whatever the
    -- earlier version happened to call them.
    DROP TABLE part_alternatives;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS part_alternatives (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  part_id                 INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  alternate_part_id       INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  -- Which of the pair this revision is actually built with. FALSE means the
  -- BOM line itself is fitted and the alternate is an approved standby; TRUE
  -- means this revision ships with the alternate in its place. Recording a
  -- substitution is the whole point of the flag — "is the alternate in the
  -- BOM?" cannot be answered by looking at the BOM, because the alternate is
  -- a catalog part, not a BOM row.
  --
  -- DEFAULT FALSE is for the backfill below, not for new links: rows that
  -- predate this column must not retroactively claim their revision was
  -- substituted. The route creates new links with TRUE explicitly (adding an
  -- alternative means you are using it) and carries the existing value over
  -- when swapping which part the alternative is.
  alternate_in_use        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_part_alternatives_not_self CHECK (part_id <> alternate_part_id)
);

-- `alternate_in_use` arrived after the table did, so a database created by an
-- earlier run of this file has the table (and therefore skips the CREATE
-- above) without the column. Additive and idempotent, so it is safe on every
-- path — unlike a shape change, this needs no drop and loses nothing.
ALTER TABLE part_alternatives
  ADD COLUMN IF NOT EXISTS alternate_in_use BOOLEAN NOT NULL DEFAULT FALSE;

-- The cardinality rule itself. Also the lookup index for "this revision's
-- links", since it leads with sub_product_revision_id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_alternatives_one_per_part
  ON part_alternatives(sub_product_revision_id, part_id);

-- Both FKs cascade on delete, so each wants its own index to keep a part
-- delete from scanning this table twice.
CREATE INDEX IF NOT EXISTS idx_part_alternatives_part_id
  ON part_alternatives(part_id);
CREATE INDEX IF NOT EXISTS idx_part_alternatives_alternate_part_id
  ON part_alternatives(alternate_part_id);

COMMIT;
