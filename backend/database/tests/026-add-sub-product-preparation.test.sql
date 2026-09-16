-- Structural test for migration 026 (sub-product preparation).
--
-- The service tests (src/services/projectPreparation.test.ts) cover what the
-- API does; this covers what the DATABASE refuses no matter what the API
-- does — the constraints the code deliberately leans on rather than
-- re-checking, plus the one change 026 made to an existing object that
-- nothing else would notice if it were reverted.
--
-- Runs in one transaction and ends in ROLLBACK, so it leaves no rows behind.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/026-add-sub-product-preparation.test.sql
-- Silence plus "ALL ASSERTIONS PASSED" at the end means green.

\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;

BEGIN;

CREATE PROCEDURE pg_temp.must_equal(got anyelement, want anyelement, what text) AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'ASSERTION FAILED — %: expected %, got %', what, want, got;
  END IF;
  RAISE NOTICE 'ok      %', what;
END;
$fn$ LANGUAGE plpgsql;

CREATE PROCEDURE pg_temp.must_fail(stmt text, what text) AS $fn$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION
    WHEN check_violation OR foreign_key_violation OR unique_violation
      OR not_null_violation THEN
      RAISE NOTICE 'ok      refused: %', what;
      RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED — the database ACCEPTED: %', what;
END;
$fn$ LANGUAGE plpgsql;

CREATE PROCEDURE pg_temp.must_pass(stmt text, what text) AS $fn$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'ok      accepted: %', what;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'ASSERTION FAILED — the database REFUSED: % (%)', what, SQLERRM;
END;
$fn$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

-- products.type and sub_products.type are each an FK to their own type table.
INSERT INTO product_types (name) VALUES ('t026') ON CONFLICT DO NOTHING;
INSERT INTO sub_product_types (name) VALUES ('t026') ON CONFLICT DO NOTHING;
INSERT INTO part_categories (id, name) VALUES (9260001, 'test026 category');
INSERT INTO parts (id, category_id, name, code) VALUES
  (9260001, 9260001, 'Bracket', 'TEST026-BRK');

INSERT INTO products (id, name, sku, type) VALUES (9260001, 'Rig', 'TEST026-RIG', 't026');
INSERT INTO product_revisions (id, product_id, revision_number, label)
  VALUES (9260001, 9260001, 1, 'Rev. 1');
INSERT INTO sub_products (id, product_id, name, sku, type)
  VALUES (9260001, 9260001, 'Frame', 'TEST026-FRAME', 't026');
INSERT INTO sub_product_revisions (id, sub_product_id, revision_number, label)
  VALUES (9260001, 9260001, 1, 'A'),
         (9260002, 9260001, 2, 'B');

INSERT INTO projects (id, name, status) VALUES (9260001, 'TEST026', 'started');
INSERT INTO project_products (id, project_id, product_id, product_revision_id, quantity, position)
  VALUES (9260001, 9260001, 9260001, 9260001, 2, 0);
INSERT INTO project_parts
  (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty)
  VALUES (9260001, 9260001, 9260001, 4, 3, 1, 0, 0, 0);
INSERT INTO project_part_usages
  (id, project_part_id, project_product_id, sub_product_revision_id, qty_per_unit)
  VALUES (9260001, 9260001, 9260001, 9260001, 2);

-- ---------------------------------------------------------------------------
-- 1. picked_qty: present, integer, defaults to nothing picked, never negative
--
-- The default matters: migration 026 adds this column to rows that already
-- exist, and every one of them has had nothing picked.
-- ---------------------------------------------------------------------------

-- Read into `text` variables rather than a record: information_schema's
-- columns are domains (character_data, yes_or_no), and comparing one against a
-- string literal through an `anyelement` parameter is a type-resolution
-- argument nobody wants to have. Same shape as 025's must_be_integer.
DO $$
DECLARE kind text; nullable text; dflt text;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO kind, nullable, dflt
    FROM information_schema.columns
   WHERE table_name = 'project_part_usages' AND column_name = 'picked_qty';
  CALL pg_temp.must_equal(kind, 'integer', 'picked_qty is a whole number of parts');
  CALL pg_temp.must_equal(nullable, 'NO', 'picked_qty is never unknown');
  CALL pg_temp.must_equal(dflt, '0', 'an existing usage row has picked nothing');
END $$;

CALL pg_temp.must_fail(
  'UPDATE project_part_usages SET picked_qty = -1 WHERE id = 9260001',
  'picking a negative quantity');

-- The draft of 026 that made the pick a tick is gone, and a database that ran
-- it must end up shaped like a fresh one.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*)::int INTO n FROM information_schema.columns
   WHERE table_name = 'project_part_usages' AND column_name IN ('picked_at', 'picked_by');
  CALL pg_temp.must_equal(n, 0, 'the abandoned picked_at / picked_by columns are gone');
END $$;

-- ---------------------------------------------------------------------------
-- 2. The ceiling the API leans on
--
-- `resolvePickQty` refuses an over-draw with a reason, but the reason is only
-- worth having because the database would refuse it anyway. If this CHECK ever
-- went away, a bug in the batch resolver would silently overdraw the project
-- instead of failing.
-- ---------------------------------------------------------------------------

CALL pg_temp.must_pass(
  'UPDATE project_parts SET prepared_qty = 3 WHERE id = 9260001',
  'preparing exactly what the project holds — the ceiling is inclusive');
CALL pg_temp.must_fail(
  'UPDATE project_parts SET prepared_qty = 4 WHERE id = 9260001',
  'preparing more than from_stock + received');
UPDATE project_parts SET prepared_qty = 0 WHERE id = 9260001;

-- ---------------------------------------------------------------------------
-- 3. One preparation per (product-in-the-project, sub-product revision)
-- ---------------------------------------------------------------------------

CALL pg_temp.must_pass(
  'INSERT INTO project_sub_product_preparations (project_product_id, sub_product_revision_id)
   VALUES (9260001, 9260001)',
  'marking a sub-product prepared');
CALL pg_temp.must_fail(
  'INSERT INTO project_sub_product_preparations (project_product_id, sub_product_revision_id)
   VALUES (9260001, 9260001)',
  'marking the same sub-product twice');
CALL pg_temp.must_pass(
  'INSERT INTO project_sub_product_preparations (project_product_id, sub_product_revision_id)
   VALUES (9260001, 9260002)',
  'a second revision of the same sub-product is its own row');
CALL pg_temp.must_fail(
  'INSERT INTO project_sub_product_preparations (project_product_id, sub_product_revision_id)
   VALUES (9260001, 987654321)',
  'a preparation pointing at a revision that does not exist');

-- A revision a project has already prepared cannot be deleted out from under
-- it — deliberately no ON DELETE clause, like project_part_usages.
CALL pg_temp.must_fail(
  'DELETE FROM sub_product_revisions WHERE id = 9260002',
  'deleting a sub-product revision a project has prepared');

-- ---------------------------------------------------------------------------
-- 4. The index 026 had to un-partial
--
-- 023 indexed project_parts(part_id) WHERE prepared_qty < from_stock + received,
-- exactly the predicate the cross-project "reserved" aggregate used. 026 drops
-- that term from the aggregate, so the index has to lose the WHERE with it or
-- it silently stops covering the query — which nothing else here would catch,
-- because the query keeps returning the right answer, slowly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
   WHERE tablename = 'project_parts' AND indexname = 'idx_project_parts_part_id';
  CALL pg_temp.must_equal(def IS NULL, false, 'idx_project_parts_part_id exists');
  CALL pg_temp.must_equal(position(' WHERE ' in def) > 0, false,
    'and is no longer partial, so it still covers the reserved aggregate');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Deleting the pinned product takes its preparations with it
-- ---------------------------------------------------------------------------

DO $$
DECLARE n integer;
BEGIN
  DELETE FROM project_part_usages WHERE project_product_id = 9260001;
  DELETE FROM project_products WHERE id = 9260001;
  SELECT count(*)::int INTO n FROM project_sub_product_preparations
   WHERE project_product_id = 9260001;
  CALL pg_temp.must_equal(n, 0, 'preparations cascade with the product they belong to');
END $$;

ROLLBACK;

\echo 'ALL ASSERTIONS PASSED'
