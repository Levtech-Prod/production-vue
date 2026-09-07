-- Behaviour test for the board payload (projects-preparation-plan.md §4.1),
-- i.e. the query behind `GET /api/projects` in backend/src/routes/projects.ts.
--
-- The board is the one place where the plan's counting rules are written as
-- SQL, and nothing in the UI can reach them until Start exists (§7 step 8):
-- before that every project has zero `project_parts` rows, so every count is
-- zero and four of the five columns are permanently empty. Without this test
-- an inverted comparison here would stay invisible for a whole story and then
-- surface as a bug in the story that merely started populating the table.
--
-- The SELECT below is a copy of the route's, kept deliberately literal so a
-- change there that is not made here shows up as a failure rather than as
-- drift. Membership itself is derived in the API, not in SQL (§4.1), so the
-- flags are recomputed here from the counts the query returns.
--
-- Runs in one transaction and ends in ROLLBACK, so it leaves no rows behind.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/025-project-board-query.test.sql
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

-- ---------------------------------------------------------------------------
-- Fixture. Ids are explicit and far out of the way; the transaction rolls back.
-- One project per state the board has to tell apart.
-- ---------------------------------------------------------------------------

INSERT INTO product_types (name) VALUES ('t025') ON CONFLICT DO NOTHING;
INSERT INTO part_categories (id, name) VALUES (9250001, 'test025 category');
INSERT INTO parts (id, category_id, name, code) VALUES
  (9250001, 9250001, 'Screw M3',  'TEST025-SCR'),
  (9250002, 9250001, 'Relay 5V',  'TEST025-RLY'),
  (9250003, 9250001, 'Diode',     'TEST025-DIO'),
  (9250004, 9250001, 'Capacitor', 'TEST025-CAP'),
  (9250005, 9250001, 'Resistor',  'TEST025-RES'),
  (9250006, 9250001, 'Inductor',  'TEST025-IND'),
  (9250007, 9250001, 'Fuse',      'TEST025-FUS');

INSERT INTO products (id, name, sku, type) VALUES
  (9250001, 'Fuel Controller', 'TEST025-FC', 't025'),
  (9250002, 'Display',         'TEST025-DSP', 't025');
INSERT INTO product_revisions (id, product_id, revision_number, label) VALUES
  (9250001, 9250001, 1, 'Rev. 1'),
  (9250003, 9250001, 3, 'Rev. 3'),
  (9250002, 9250002, 2, 'Rev. 2');

INSERT INTO projects (id, name, status, created_at) VALUES
  (9250001, 'TEST025 draft',     'draft',     now() - interval '5 min'),
  (9250002, 'TEST025 mixed',     'started',   now() - interval '4 min'),
  (9250003, 'TEST025 all done',  'started',   now() - interval '3 min'),
  (9250004, 'TEST025 stopped',   'stopped',   now() - interval '2 min'),
  (9250005, 'TEST025 completed', 'completed', now() - interval '1 min'),
  -- Every sourcing column zero on every line: the three outstanding counts are
  -- all 0, so the pre-floor rule called this project Prepared while it had
  -- obtained nothing at all.
  (9250006, 'TEST025 unsourced',  'started',   now() - interval '30 sec');

-- The draft pins two products; `position` decides the order the card lists
-- them in, and is deliberately not the insert order here.
INSERT INTO project_products (project_id, product_id, product_revision_id, quantity, position) VALUES
  (9250001, 9250002, 9250002, 10, 1),
  (9250001, 9250001, 9250003, 20, 0);

-- One line per state the counts have to separate. The CHECK constraints on
-- project_parts force ordered <= missing, received <= ordered and
-- prepared <= from_stock + received, so "nothing outstanding" is equality.
--                                         req  stock  missing  ordered  received  prepared
INSERT INTO project_parts
  (project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (9250002, 9250001, 10, 0, 10,  0,  0,  0),   -- to buy only
  (9250002, 9250002,  5, 0,  5,  5,  0,  0),   -- on order only
  (9250002, 9250003,  4, 4,  0,  0,  0,  0),   -- to pick only
  (9250002, 9250004,  3, 3,  0,  0,  0,  3),   -- nothing outstanding
  (9250002, 9250005, 10, 1, 10,  4,  2,  0),   -- to buy AND on order AND to pick
  -- Pickable only because goods arrived: from_stock alone is not above
  -- prepared, so this line is what proves received_qty belongs in the sum.
  (9250002, 9250006,  2, 0,  2,  2,  2,  0),
  -- Nothing sourced at all: every CHECK accepts this row and all three
  -- comparisons above are equalities, so without the `prepared >= required`
  -- floor it would count as done and the card would read 100% prepared.
  (9250002, 9250007,  5, 0,  0,  0,  0,  0);

INSERT INTO project_parts
  (project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (9250003, 9250001, 2, 2, 0, 0, 0, 2),        -- all lines done
  (9250003, 9250002, 7, 0, 7, 7, 7, 7);

-- A stopped project keeps its rows; its claims are released (§3.1), so it
-- must sit in *Projects* alone however outstanding those rows look.
INSERT INTO project_parts
  (project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (9250004, 9250001, 9, 0, 9, 3, 1, 0);

INSERT INTO project_parts
  (project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (9250005, 9250001, 6, 6, 0, 0, 0, 6);

INSERT INTO project_parts
  (project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (9250006, 9250001, 5, 0, 0, 0, 0, 0);

-- ---------------------------------------------------------------------------
-- The board query, verbatim from routes/projects.ts, into a temp table.
-- $1 is the status filter, $2 the name search.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE board ON COMMIT DROP AS
SELECT
  p.id,
  p.name,
  p.description,
  to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
  p.status,
  p.created_at AS "createdAt",
  (SELECT COALESCE(
            json_agg(json_build_object(
              'name', prod.name,
              'sku', prod.sku,
              'revisionLabel', rev.label,
              'quantity', pprod.quantity
            ) ORDER BY pprod.position, pprod.id),
            '[]')
   FROM project_products pprod
   JOIN products prod ON prod.id = pprod.product_id
   JOIN product_revisions rev ON rev.id = pprod.product_revision_id
   WHERE pprod.project_id = p.id) AS products,
  COUNT(pp.id)::int AS "lineCount",
  COUNT(*) FILTER (WHERE pp.missing_qty  > pp.ordered_qty)::int  AS "toBuyLines",
  COUNT(*) FILTER (WHERE pp.ordered_qty  > pp.received_qty)::int AS "onOrderLines",
  COUNT(*) FILTER (WHERE pp.from_stock_qty + pp.received_qty
                       > pp.prepared_qty)::int                  AS "toPickLines",
  COUNT(*) FILTER (WHERE pp.missing_qty <= pp.ordered_qty
                     AND pp.ordered_qty <= pp.received_qty
                     AND pp.from_stock_qty + pp.received_qty
                         <= pp.prepared_qty
                     AND pp.prepared_qty >= pp.required_qty)::int AS "doneLines"
FROM projects p
LEFT JOIN project_parts pp ON pp.project_id = p.id
WHERE p.status = ANY(ARRAY['draft','started','stopped','completed']::text[])
  AND ('TEST025' IS NULL OR p.name ILIKE '%' || 'TEST025' || '%')
GROUP BY p.id
ORDER BY p.created_at DESC;

-- Column membership, recomputed exactly as routes/projects.ts derives it.
CREATE TEMP VIEW flags AS
SELECT id, name, status, "lineCount", "toBuyLines", "onOrderLines",
       "toPickLines", "doneLines", products,
       (status IN ('started','completed'))                        AS derived,
       (status IN ('started','completed') AND "toBuyLines"    > 0) AS "inOffers",
       (status IN ('started','completed') AND "onOrderLines"  > 0) AS "inOrdered",
       (status IN ('started','completed') AND "toPickLines"   > 0) AS "inPreparation",
       (status IN ('started','completed') AND "lineCount" > 0
          AND "doneLines" = "lineCount")                          AS "inPrepared"
FROM board;

-- ---------------------------------------------------------------------------
-- 1. The search and the ordering
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT count(*)::int AS n INTO r FROM board;
  CALL pg_temp.must_equal(r.n, 6, 'the name search returns exactly the six fixture projects');

  SELECT string_agg(name, ' | ' ORDER BY "createdAt" DESC) AS names INTO r FROM board;
  CALL pg_temp.must_equal(
    r.names,
    'TEST025 unsourced | TEST025 completed | TEST025 stopped | TEST025 all done | TEST025 mixed | TEST025 draft',
    'newest project first');
END $$;

-- ---------------------------------------------------------------------------
-- 2. A draft: products listed, no lines, no derived column
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250001;
  CALL pg_temp.must_equal(r."lineCount", 0, 'a draft has no frozen lines');
  CALL pg_temp.must_equal(r."doneLines", 0, 'a draft has no done lines');
  CALL pg_temp.must_equal(
    r."inOffers" OR r."inOrdered" OR r."inPreparation" OR r."inPrepared", false,
    'a draft is in the Projects column only');
  CALL pg_temp.must_equal(json_array_length(r.products), 2,
    'the card lists both pinned products');
  CALL pg_temp.must_equal(r.products->0->>'name', 'Fuel Controller',
    'products come back in `position` order, not insert order');
  CALL pg_temp.must_equal(r.products->0->>'revisionLabel', 'Rev. 3',
    'each product carries the revision the project pinned');
  CALL pg_temp.must_equal((r.products->0->>'quantity')::int, 20,
    'each product carries its quantity');
END $$;

-- ---------------------------------------------------------------------------
-- 3. The counts, including a line that is in three buckets at once
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250002;
  CALL pg_temp.must_equal(r."lineCount",    7, 'lineCount counts every frozen line');
  CALL pg_temp.must_equal(r."toBuyLines",   2, 'toBuyLines: the to-buy line and the three-way line');
  CALL pg_temp.must_equal(r."onOrderLines", 2, 'onOrderLines: the on-order line and the three-way line');
  CALL pg_temp.must_equal(r."toPickLines",  3, 'toPickLines: the to-pick, three-way and received-not-picked lines');
  -- The point of doneLines existing at all: the three counts above overlap,
  -- so lineCount minus their sum would be 7 - 7 = 0 here, not 1.
  CALL pg_temp.must_equal(r."doneLines",    1, 'doneLines counts only the line with nothing outstanding');
END $$;

-- The floor on `doneLines`: a line can be in no bucket at all — outstanding in
-- none of the three senses, because every sourcing column is zero, yet not
-- done because nothing was actually obtained. Counted straight off the table,
-- so this assertion states the shape of the data rather than restating the
-- query.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*)::int INTO n FROM project_parts
   WHERE project_id = 9250002
     AND NOT (missing_qty > ordered_qty)
     AND NOT (ordered_qty > received_qty)
     AND NOT (from_stock_qty + received_qty > prepared_qty)
     AND NOT (prepared_qty >= required_qty);
  CALL pg_temp.must_equal(n, 1, 'a line that sourced nothing is neither outstanding nor done');
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250002;
  CALL pg_temp.must_equal(r."inOffers",      true,  'a project with a line to buy is in Offers');
  CALL pg_temp.must_equal(r."inOrdered",     true,  'a project with a line on order is in Ordered');
  CALL pg_temp.must_equal(r."inPreparation", true,  'a project with a pickable line is in Preparation');
  CALL pg_temp.must_equal(r."inPrepared",    false, 'Prepared is ALL lines done, not any');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Prepared, and doneLines agreeing with it
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250003;
  CALL pg_temp.must_equal(r."toBuyLines" + r."onOrderLines" + r."toPickLines", 0,
    'a finished project has nothing outstanding');
  CALL pg_temp.must_equal(r."inPrepared", true, 'every line done puts the project in Prepared');
  CALL pg_temp.must_equal(r."doneLines" = r."lineCount", true,
    'doneLines = lineCount is the same test as inPrepared');
END $$;

DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*)::int INTO bad FROM flags
   WHERE derived AND ("inPrepared" <> ("lineCount" > 0 AND "doneLines" = "lineCount"));
  CALL pg_temp.must_equal(bad, 0,
    'inPrepared and doneLines = lineCount never disagree, for any fixture project');
END $$;

-- ---------------------------------------------------------------------------
-- 4b. Nothing outstanding is not the same as finished
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250006;
  CALL pg_temp.must_equal(r."toBuyLines" + r."onOrderLines" + r."toPickLines", 0,
    'a project that sourced nothing has no outstanding lines either');
  CALL pg_temp.must_equal(r."doneLines", 0, 'but none of its lines is done');
  CALL pg_temp.must_equal(r."inPrepared", false,
    'so it is NOT in Prepared — the three counts being zero is not enough');
END $$;

-- ---------------------------------------------------------------------------
-- 5. A stopped project keeps its rows but leaves the derived columns (§3.1)
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250004;
  CALL pg_temp.must_equal(r."lineCount", 1, 'a stopped project keeps its frozen lines');
  CALL pg_temp.must_equal(r."toBuyLines" > 0, true, 'and those lines still look outstanding');
  CALL pg_temp.must_equal(
    r."inOffers" OR r."inOrdered" OR r."inPreparation" OR r."inPrepared", false,
    'yet a stopped project sits in the Projects column alone');
END $$;

-- ---------------------------------------------------------------------------
-- 6. A completed project still reaches Prepared (§3.1)
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250005;
  CALL pg_temp.must_equal(r."inPrepared", true, 'a completed project is in Prepared');
END $$;

-- ---------------------------------------------------------------------------
-- 7. The status filter is what limits the board, not the membership rule
-- ---------------------------------------------------------------------------

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*)::int INTO n FROM projects
   WHERE status = ANY(ARRAY['draft','started']::text[]) AND name ILIKE '%TEST025%';
  CALL pg_temp.must_equal(n, 4, 'the default draft+started filter hides stopped and completed');
END $$;

ROLLBACK;

\echo 'ALL ASSERTIONS PASSED'
