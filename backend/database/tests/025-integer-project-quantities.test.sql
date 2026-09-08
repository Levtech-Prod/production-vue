-- Constraint smoke test for migration 025 (projects-preparation-plan.md §3.3,
-- §11.11): every quantity a project deals in is a whole number of parts.
--
-- Two different guarantees are asserted here, because the database gives them
-- differently. An INTEGER column does NOT refuse 1.5 — it rounds it — so for
-- those the assertion is on the column TYPE, and the refusal of a fraction is
-- the API's job (parts.schema.ts, stock entry schemas). stock_entries keeps a
-- NUMERIC column and a CHECK, which does refuse outright.
--
-- Runs in one transaction and ends in ROLLBACK, so it leaves no rows behind
-- and is safe against a development database, exactly like the 023 test. NOT
-- safe to point at production: the rollback undoes the writes, the locks are
-- real.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/025-integer-project-quantities.test.sql

\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;

BEGIN;

CREATE PROCEDURE pg_temp.must_be_integer(tbl text, col text) AS $fn$
DECLARE t text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
   WHERE table_name = tbl AND column_name = col;
  IF t IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — %.% is %, not integer', tbl, col, COALESCE(t, 'missing');
  END IF;
  RAISE NOTICE 'ok      whole parts: %.%', tbl, col;
END;
$fn$ LANGUAGE plpgsql;

CREATE PROCEDURE pg_temp.must_fail(stmt text, what text) AS $fn$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION
    WHEN check_violation OR foreign_key_violation OR unique_violation
      OR not_null_violation THEN
      RAISE NOTICE 'ok      rejected: %', what;
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

-- 1. Everything the projects module counts in parts.
CALL pg_temp.must_be_integer('project_parts', 'required_qty');
CALL pg_temp.must_be_integer('project_parts', 'from_stock_qty');
CALL pg_temp.must_be_integer('project_parts', 'missing_qty');
CALL pg_temp.must_be_integer('project_parts', 'ordered_qty');
CALL pg_temp.must_be_integer('project_parts', 'received_qty');
CALL pg_temp.must_be_integer('project_parts', 'prepared_qty');
CALL pg_temp.must_be_integer('project_part_usages', 'qty_per_unit');
CALL pg_temp.must_be_integer('order_lines', 'quantity');
CALL pg_temp.must_be_integer('order_lines', 'received_qty');
-- 2. And the BOM line required_qty is computed from, without which the rest
--    would be an integer built out of fractions.
CALL pg_temp.must_be_integer('sub_product_revision_parts', 'quantity');

-- 3. Stock keeps NUMERIC, so here the CHECK is what refuses a fraction —
--    available stock feeds project_parts.from_stock_qty. Seeds its own rows
--    rather than borrowing whatever the database happens to hold, so the
--    assertion cannot quietly skip on an empty database.
INSERT INTO part_categories (id, name) VALUES (9992001, 'test-025 category');
INSERT INTO companies (id, name) VALUES (9992001, 'test-025 company');
INSERT INTO parts (id, category_id, name, code)
  VALUES (9992001, 9992001, 'test-025 part', 'TEST-025-PART');

CALL pg_temp.must_fail(
  'INSERT INTO stock_entries (part_id, company_id, type, quantity, price_per_piece)
   VALUES (9992001, 9992001, ''received'', 1.5, 1)',
  'a stock entry of 1.5 parts');
CALL pg_temp.must_fail(
  'INSERT INTO stock_entries (part_id, company_id, type, quantity, quantity_consumed, price_per_piece)
   VALUES (9992001, 9992001, ''received'', 10, 2.5, 1)',
  'consuming 2.5 of a part');
CALL pg_temp.must_pass(
  'INSERT INTO stock_entries (part_id, company_id, type, quantity, quantity_consumed, price_per_piece)
   VALUES (9992001, 9992001, ''received'', 10, 3, 1)',
  'a stock entry of 10 parts with 3 consumed');

ROLLBACK;

\echo 'ALL ASSERTIONS PASSED'
