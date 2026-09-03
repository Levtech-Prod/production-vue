-- Constraint smoke test for migration 023 (projects-preparation-plan.md §3).
--
-- Proves the schema BEHAVES, not merely that it applies: every assertion below
-- either states that the database must refuse something, or that it must
-- accept it. Six of these describe corruption the first version of 023 allowed.
--
-- Runs in one transaction and ends in ROLLBACK, so it leaves no rows behind and
-- is safe against a development database. It is NOT safe to point at production
-- — a stray `ON DELETE CASCADE` bug would be rolled back, but the locks are real.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/023-add-projects.test.sql
-- Silence plus "ALL ASSERTIONS PASSED" at the end means green; ON_ERROR_STOP
-- turns the first broken assertion into a non-zero exit.

\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;

BEGIN;

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

-- ---------------------------------------------------------------------------
-- Fixture. Ids are explicit and far out of the way; the transaction rolls back.
-- Two projects, so cross-project mixing can be attempted.
-- ---------------------------------------------------------------------------

INSERT INTO product_types (name) VALUES ('t023') ON CONFLICT DO NOTHING;
INSERT INTO sub_product_types (name) VALUES ('t023') ON CONFLICT DO NOTHING;

INSERT INTO users (id, username, email, password_hash)
  VALUES (9230001, 'test023', 'test023@example.invalid', 'x');
INSERT INTO part_categories (id, name) VALUES (9230001, 'test023 category');
INSERT INTO parts (id, category_id, name, code) VALUES
  (9230001, 9230001, 'Screw M3', 'TEST023-SCR-M3'),
  (9230002, 9230001, 'Relay 5V', 'TEST023-RLY-5V');

INSERT INTO products (id, name, sku, type) VALUES
  (9230001, 'Controller', 'TEST023-CTRL', 't023'),
  (9230002, 'Power supply', 'TEST023-PSU', 't023');
INSERT INTO product_revisions (id, product_id, revision_number, label) VALUES
  (9230001, 9230001, 1, 'R1'),
  (9230002, 9230001, 2, 'R2'),   -- same product, second revision
  (9230003, 9230002, 1, 'R1');   -- a DIFFERENT product's revision

INSERT INTO sub_products (id, product_id, name, type)
  VALUES (9230001, 9230001, 'Base', 't023');
INSERT INTO sub_product_revisions (id, sub_product_id, revision_number, label)
  VALUES (9230001, 9230001, 1, 'A');
INSERT INTO sub_product_revision_parts (sub_product_revision_id, part_id, quantity)
  VALUES (9230001, 9230001, 2);
INSERT INTO product_revision_sub_products (product_revision_id, sub_product_revision_id)
  VALUES (9230001, 9230001);

INSERT INTO companies (id, name) VALUES
  (9230001, 'TEST023 Acme'), (9230002, 'TEST023 Globex');

INSERT INTO projects (id, name) VALUES (9230001, 'Line A'), (9230002, 'Line B');

INSERT INTO project_products (id, project_id, product_id, product_revision_id, quantity)
  VALUES (9230001, 9230001, 9230001, 9230001, 2),   -- project A
         (9230002, 9230002, 9230002, 9230003, 1);   -- project B

INSERT INTO project_parts
  (id, project_id, part_id, required_qty, from_stock_qty, missing_qty)
  VALUES (9230001, 9230001, 9230001, 4, 1, 3),      -- project A
         (9230002, 9230002, 9230001, 5, 0, 5);      -- project B, same part

INSERT INTO orders (id, project_id, company_id)
  VALUES (9230001, 9230001, 9230001);               -- an order for project A
INSERT INTO project_offer_companies (id, project_id, company_id)
  VALUES (9230001, 9230001, 9230001);               -- a column on project A

-- ---------------------------------------------------------------------------
-- 1. project_products — the revision must belong to the product (§3.2)
-- ---------------------------------------------------------------------------

CALL pg_temp.must_fail($$
  INSERT INTO project_products (project_id, product_id, product_revision_id, quantity)
  VALUES (9230001, 9230001, 9230003, 1)$$,
  'a revision belonging to a different product');

CALL pg_temp.must_pass($$
  INSERT INTO project_products (project_id, product_id, product_revision_id, quantity)
  VALUES (9230001, 9230001, 9230002, 1)$$,
  'the same product a second time at a different revision');

CALL pg_temp.must_fail($$
  INSERT INTO project_products (project_id, product_id, product_revision_id, quantity)
  VALUES (9230001, 9230001, 9230001, 1)$$,
  'the same product revision twice in one project');

CALL pg_temp.must_fail($$
  INSERT INTO project_products (project_id, product_id, product_revision_id, quantity)
  VALUES (9230001, 9230001, 9230001, 0)$$,
  'a project product with quantity 0');

-- ---------------------------------------------------------------------------
-- 2. project_parts — the quantity buckets stay ordered (§3.3)
-- ---------------------------------------------------------------------------

CALL pg_temp.must_fail(
  'UPDATE project_parts SET ordered_qty = 99 WHERE id = 9230001',
  'ordered_qty above missing_qty');

CALL pg_temp.must_fail(
  'UPDATE project_parts SET received_qty = 1 WHERE id = 9230001',
  'received_qty above ordered_qty');

CALL pg_temp.must_fail(
  'UPDATE project_parts SET prepared_qty = 99 WHERE id = 9230001',
  'prepared_qty above from_stock_qty + received_qty');

CALL pg_temp.must_fail($$
  INSERT INTO project_parts (project_id, part_id, required_qty)
  VALUES (9230001, 9230002, 0)$$,
  'a project part requiring 0 (see the PRECONDITION note in the migration)');

CALL pg_temp.must_fail($$
  INSERT INTO project_parts (project_id, part_id, required_qty)
  VALUES (9230001, 9230001, 1)$$,
  'the same part twice in one project');

CALL pg_temp.must_pass(
  'UPDATE project_parts SET ordered_qty = 3, received_qty = 3, prepared_qty = 4
     WHERE id = 9230001',
  'a fully ordered, received and prepared line');

-- The write-order trap, asserted so nobody "simplifies" it away by accident:
-- CHECKs are not deferrable, so moving quantity between columns needs ONE
-- statement. This pair would end in a legal state and still fails.
CALL pg_temp.must_fail(
  'UPDATE project_parts SET missing_qty = 0 WHERE id = 9230001',
  'lowering missing_qty below ordered_qty in its own statement');

CALL pg_temp.must_pass(
  'UPDATE project_parts SET missing_qty = 0, ordered_qty = 0, received_qty = 0,
                            from_stock_qty = 4, prepared_qty = 4
     WHERE id = 9230001',
  'the same move written as a single UPDATE');

-- ---------------------------------------------------------------------------
-- 3. project_part_usages — one row per usage site (§3.4)
-- ---------------------------------------------------------------------------

CALL pg_temp.must_pass($$
  INSERT INTO project_part_usages
    (project_part_id, project_product_id, sub_product_revision_id, qty_per_unit)
  VALUES (9230001, 9230001, 9230001, 2)$$,
  'a usage row');

CALL pg_temp.must_fail($$
  INSERT INTO project_part_usages
    (project_part_id, project_product_id, sub_product_revision_id, qty_per_unit)
  VALUES (9230001, 9230001, 9230001, 2)$$,
  'the same usage site twice');

CALL pg_temp.must_fail($$
  INSERT INTO project_part_usages
    (project_part_id, project_product_id, sub_product_revision_id, qty_per_unit)
  VALUES (9230001, 9230001, 9230001, 0)$$,
  'a usage of 0 per unit');

-- ---------------------------------------------------------------------------
-- 4. Offers (§3.5)
-- ---------------------------------------------------------------------------

CALL pg_temp.must_pass($$
  INSERT INTO project_offer_prices
    (project_id, offer_company_id, project_part_id, price_per_piece)
  VALUES (9230001, 9230001, 9230001, 0)$$,
  'a quoted price of zero (a free part is a real quote)');

CALL pg_temp.must_fail($$
  UPDATE project_offer_prices SET price_per_piece = -1
   WHERE project_part_id = 9230001$$,
  'a negative quoted price');

CALL pg_temp.must_fail($$
  INSERT INTO project_offer_prices
    (project_id, offer_company_id, project_part_id, price_per_piece)
  VALUES (9230002, 9230001, 9230002, 1)$$,
  'a price cell pairing project A''s company column with project B''s part');

CALL pg_temp.must_fail($$
  INSERT INTO project_offer_companies (project_id, company_id)
  VALUES (9230001, 9230001)$$,
  'the same company added twice to one project');

-- ---------------------------------------------------------------------------
-- 5. Orders (§3.6) — the three holes the first version of 023 left open
-- ---------------------------------------------------------------------------

CALL pg_temp.must_fail($$
  INSERT INTO order_lines (order_id, project_id, project_part_id, part_id, quantity)
  VALUES (9230001, 9230001, 9230001, 9230002, 1)$$,
  'an order line whose part_id contradicts its project_part');

CALL pg_temp.must_fail($$
  INSERT INTO order_lines (order_id, project_id, project_part_id, part_id, quantity)
  VALUES (9230001, 9230002, 9230002, 9230001, 1)$$,
  'an order for project A carrying a line from project B');

CALL pg_temp.must_fail($$
  INSERT INTO order_lines (order_id, project_id, project_part_id, part_id, quantity)
  VALUES (9230001, 9230001, 9230002, 9230001, 1)$$,
  'an order line claiming project A while its project_part is project B''s');

CALL pg_temp.must_pass($$
  INSERT INTO order_lines (order_id, project_id, project_part_id, part_id, quantity)
  VALUES (9230001, 9230001, 9230001, 9230001, 3)$$,
  'a consistent order line');

CALL pg_temp.must_fail($$
  INSERT INTO order_lines (order_id, project_id, project_part_id, part_id, quantity)
  VALUES (9230001, 9230001, 9230001, 9230001, 1)$$,
  'the same project part twice in one order');

CALL pg_temp.must_fail($$
  INSERT INTO order_lines (order_id, project_id, project_part_id, part_id, quantity)
  VALUES (9230001, 9230001, 9230001, 9230001, 0)$$,
  'an order line of quantity 0');

-- ---------------------------------------------------------------------------
-- 6. Deletes — what a project protects, and what it takes with it
-- ---------------------------------------------------------------------------

CALL pg_temp.must_fail(
  'DELETE FROM parts WHERE id = 9230001',
  'deleting a part a project claims (PART_IN_USE_BY_PROJECT)');

CALL pg_temp.must_fail(
  'DELETE FROM sub_product_revisions WHERE id = 9230001',
  'deleting a sub-product revision a project usage claims');

CALL pg_temp.must_fail(
  'DELETE FROM companies WHERE id = 9230001',
  'deleting a company that is an offer column');

DO $$
DECLARE n integer;
BEGIN
  DELETE FROM order_lines WHERE order_id = 9230001;
  DELETE FROM orders WHERE project_id = 9230001;
  DELETE FROM projects WHERE id = 9230001;

  SELECT count(*) INTO n FROM project_products WHERE project_id = 9230001;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERTION FAILED — % project_products survived the project', n; END IF;
  SELECT count(*) INTO n FROM project_parts WHERE project_id = 9230001;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERTION FAILED — % project_parts survived the project', n; END IF;
  SELECT count(*) INTO n FROM project_part_usages WHERE project_part_id = 9230001;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERTION FAILED — % project_part_usages survived the project', n; END IF;
  SELECT count(*) INTO n FROM project_offer_companies WHERE project_id = 9230001;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERTION FAILED — % offer columns survived the project', n; END IF;
  RAISE NOTICE 'ok      deleting a project took its products, parts, usages and offer columns';
END $$;

-- ---------------------------------------------------------------------------
-- 7. Precondition on the data already in this database, not on the schema.
--    The freeze (story 5) computes required_qty from these rows, and
--    `CHECK (required_qty > 0)` will reject any project built on a zero or
--    negative BOM line. Reported, not asserted: on an empty dev database this
--    is trivially clean and only production can answer it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM sub_product_revision_parts WHERE quantity <= 0;
  IF n = 0 THEN
    RAISE NOTICE 'ok      no BOM line in this database has quantity <= 0';
  ELSE
    RAISE WARNING 'PRECONDITION UNMET — % BOM line(s) have quantity <= 0; the freeze will fail on any project using them', n;
  END IF;
END $$;

ROLLBACK;

\echo 'ALL ASSERTIONS PASSED'
