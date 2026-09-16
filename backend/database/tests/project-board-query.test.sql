-- Behaviour test for the board payload (projects-preparation-plan.md §4.1),
-- i.e. the two queries behind `GET /api/projects` — now in
-- backend/src/services/projectBoard.ts (the per-project counts) and
-- backend/src/services/projectPreparation.ts (`loadBoardSubProducts`).
--
-- The board is the one place where the plan's counting rules are written as
-- SQL, and nothing in the UI can reach them until Start exists (§7 step 8):
-- before that every project has zero `project_parts` rows, so every count is
-- zero and four of the five columns are permanently empty. Without this test
-- an inverted comparison here would stay invisible for a whole story and then
-- surface as a bug in the story that merely started populating the table.
--
-- Both SELECTs below are copies of the services' own, kept deliberately
-- literal. That is a weaker guarantee than it sounds — a copy does not fail
-- when the original changes, it just quietly stops describing it, which is
-- exactly what happened when migration 026 replaced `toPickLines`/`doneLines`
-- with per-sub-product membership and this file went on asserting the old
-- three counts and passing. So: CHANGING EITHER QUERY MEANS CHANGING THIS
-- FILE. What cannot drift is the membership rule itself, which is derived here
-- from the counts exactly as the service derives it, and is the thing the
-- assertions are actually about.
--
-- Runs in one transaction and ends in ROLLBACK, so it leaves no rows behind.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/project-board-query.test.sql
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

-- products.type and sub_products.type are each an FK to their own type table.
INSERT INTO product_types (name) VALUES ('t025') ON CONFLICT DO NOTHING;
INSERT INTO sub_product_types (name) VALUES ('t025') ON CONFLICT DO NOTHING;
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

-- Preparation happens one sub-product at a time (migration 026), so the board
-- needs sub-products to split its *Preparation* column by.
INSERT INTO sub_products (id, product_id, name, sku, type) VALUES
  (9250001, 9250001, 'Base',  'TEST025-BASE',  't025'),
  (9250002, 9250001, 'Cover', 'TEST025-COVER', 't025');
INSERT INTO sub_product_revisions (id, sub_product_id, revision_number, label) VALUES
  (9250001, 9250001, 1, 'A'),
  (9250002, 9250002, 1, 'B');

INSERT INTO projects (id, name, status, created_at) VALUES
  (9250001, 'TEST025 draft',     'draft',     now() - interval '5 min'),
  (9250002, 'TEST025 mixed',     'started',   now() - interval '4 min'),
  (9250003, 'TEST025 all done',  'started',   now() - interval '3 min'),
  (9250004, 'TEST025 stopped',   'stopped',   now() - interval '2 min'),
  (9250005, 'TEST025 completed', 'completed', now() - interval '1 min'),
  -- Started, but nothing was ever frozen under it: no usage rows, so no
  -- sub-product cards. The replacement for the old `doneLines` floor — a
  -- project that has obtained nothing must not read as prepared.
  (9250006, 'TEST025 unsourced', 'started',   now() - interval '30 sec');

-- The draft pins two products; `position` decides the order the card lists
-- them in, and is deliberately not the insert order here.
INSERT INTO project_products (id, project_id, product_id, product_revision_id, quantity, position) VALUES
  (9250010, 9250001, 9250002, 9250002, 10, 1),
  (9250011, 9250001, 9250001, 9250003, 20, 0),
  -- The started/stopped/completed projects each build one product, which is
  -- what their sub-product cards hang off.
  (9250020, 9250002, 9250001, 9250003,  2, 0),
  (9250030, 9250003, 9250001, 9250001,  1, 0),
  (9250040, 9250004, 9250001, 9250001,  1, 0),
  (9250050, 9250005, 9250001, 9250001,  1, 0);

-- One line per state the counts have to separate. The CHECK constraints on
-- project_parts force ordered <= missing, received <= ordered and
-- prepared <= from_stock + received.
--                                           req  stock  missing  ordered  received  prepared
INSERT INTO project_parts
  (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (92502001, 9250002, 9250001, 10, 0, 10,  0,  0,  0),   -- to buy only
  (92502002, 9250002, 9250002,  5, 0,  5,  5,  0,  0),   -- on order only
  (92502003, 9250002, 9250003,  4, 4,  0,  0,  0,  0),   -- in stock, nothing picked
  (92502004, 9250002, 9250004,  3, 3,  0,  0,  0,  3),   -- in stock and fully picked
  (92502005, 9250002, 9250005, 10, 1, 10,  4,  2,  0),   -- to buy AND on order
  (92502006, 9250002, 9250006,  2, 0,  2,  2,  2,  0),   -- pickable only because goods arrived
  (92502007, 9250002, 9250007,  5, 0,  0,  0,  0,  0);   -- nothing sourced at all

INSERT INTO project_parts
  (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (92503001, 9250003, 9250001, 2, 2, 0, 0, 0, 2),
  (92503002, 9250003, 9250002, 7, 0, 7, 7, 7, 7);

-- A stopped project keeps its rows; its claims are released (§3.1), so it
-- must sit in *Projects* alone however outstanding those rows look.
INSERT INTO project_parts
  (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (92504001, 9250004, 9250001, 9, 0, 9, 3, 1, 0);

INSERT INTO project_parts
  (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (92505001, 9250005, 9250001, 6, 6, 0, 0, 0, 6);

INSERT INTO project_parts
  (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty) VALUES
  (92506001, 9250006, 9250001, 5, 0, 0, 0, 0, 0);

-- The pick lists. `picked_qty` sums to the part's `prepared_qty` above — that
-- invariant is what makes the whole scheme work, and a fixture that broke it
-- would be testing a state the API cannot produce.
--   qty_per_unit x project_products.quantity = what the line needs.
INSERT INTO project_part_usages
  (project_part_id, project_product_id, sub_product_revision_id, qty_per_unit, picked_qty) VALUES
  -- 'mixed', product x2. Base needs 4 diodes and the project holds 4:
  -- something to do, nothing done yet.
  (92502003, 9250020, 9250001, 2, 0),
  -- Cover needs 10 screws and the project holds none of them: nothing to do
  -- TODAY, which is a card that must not appear.
  (92502001, 9250020, 9250002, 5, 0),
  -- 'all done', product x1: both sub-products picked in full.
  (92503001, 9250030, 9250001, 2, 2),
  (92503002, 9250030, 9250002, 7, 7),
  -- 'stopped': one delivered piece makes the line pickable, so the SUB-PRODUCT
  -- reads as in-preparation while the PROJECT must not.
  (92504001, 9250040, 9250001, 9, 0),
  -- 'completed': picked in full and marked.
  (92505001, 9250050, 9250001, 6, 6);

-- Only Base is marked on 'all done': the project is therefore in *Prepared*
-- (one sub-product finished) AND still in *Preparation* (Cover is not), which
-- is the behaviour migration 026 introduced and §8.1 relies on.
INSERT INTO project_sub_product_preparations (project_product_id, sub_product_revision_id) VALUES
  (9250030, 9250001),
  (9250050, 9250001);

-- ---------------------------------------------------------------------------
-- The per-project counts, verbatim from services/projectBoard.ts.
-- $1 is the status filter, $2 the name search, $3 the id filter.
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
              'projectProductId', pprod.id,
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
  COUNT(*) FILTER (WHERE pp.missing_qty  > pp.ordered_qty)::int  AS "toBuyLines",
  COUNT(*) FILTER (WHERE pp.ordered_qty  > pp.received_qty)::int AS "onOrderLines"
FROM projects p
LEFT JOIN project_parts pp ON pp.project_id = p.id
WHERE (NULL::text[] IS NULL OR p.status = ANY(NULL::text[]))
  AND ('TEST025'::text IS NULL OR p.name ILIKE '%' || 'TEST025' || '%')
  AND (NULL::int[] IS NULL OR p.id = ANY(NULL::int[]))
GROUP BY p.id
ORDER BY p.created_at DESC;

-- ---------------------------------------------------------------------------
-- The sub-product read, verbatim from `loadBoardSubProducts`.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE board_sub_products ON COMMIT DROP AS
SELECT
  pp.project_id                   AS "projectId",
  ppu.project_product_id          AS "projectProductId",
  ppu.sub_product_revision_id     AS "subProductRevisionId",
  sp.name,
  sp.sku,
  spr.label                       AS "revisionLabel",
  COUNT(*)::int                   AS "partCount",
  COUNT(*) FILTER (
    WHERE pp.from_stock_qty + pp.received_qty - pp.prepared_qty
          >= ppu.qty_per_unit * pprod.quantity - ppu.picked_qty
  )::int                          AS "readyPartCount",
  SUM(ppu.qty_per_unit * pprod.quantity)::int AS "requiredQty",
  SUM(ppu.picked_qty)::int        AS "pickedQty",
  COUNT(*) FILTER (
    WHERE ppu.picked_qty < ppu.qty_per_unit * pprod.quantity
      AND pp.from_stock_qty + pp.received_qty - pp.prepared_qty > 0
  )::int                          AS "pickablePartCount",
  (prep.id IS NOT NULL)           AS prepared
FROM project_part_usages ppu
JOIN project_parts pp          ON pp.id = ppu.project_part_id
JOIN project_products pprod    ON pprod.id = ppu.project_product_id
JOIN sub_product_revisions spr ON spr.id = ppu.sub_product_revision_id
JOIN sub_products sp           ON sp.id = spr.sub_product_id
LEFT JOIN project_sub_product_preparations prep
       ON prep.project_product_id = ppu.project_product_id
      AND prep.sub_product_revision_id = ppu.sub_product_revision_id
WHERE pp.project_id = ANY(ARRAY[9250001,9250002,9250003,9250004,9250005,9250006]::int[])
GROUP BY pp.project_id, ppu.project_product_id, ppu.sub_product_revision_id,
         sp.name, sp.sku, spr.label, prep.id, pprod.position, pprod.id
ORDER BY pprod.position, pprod.id, sp.name;

-- ---------------------------------------------------------------------------
-- Membership, derived here exactly as `loadBoardCards` derives it — this is
-- the rule the assertions below are about.
-- ---------------------------------------------------------------------------

CREATE TEMP VIEW sub_flags AS
SELECT *,
       (NOT prepared AND ("pickedQty" > 0 OR "pickablePartCount" > 0)) AS "inPreparation"
FROM board_sub_products;

CREATE TEMP VIEW flags AS
SELECT b.*,
       (b.status IN ('started','completed')) AS derived,
       (b.status IN ('started','completed') AND b."toBuyLines"   > 0) AS "inOffers",
       (b.status IN ('started','completed') AND b."onOrderLines" > 0) AS "inOrdered",
       (b.status IN ('started','completed')
          AND EXISTS (SELECT 1 FROM sub_flags s
                       WHERE s."projectId" = b.id AND s."inPreparation")) AS "inPreparation",
       (b.status IN ('started','completed')
          AND EXISTS (SELECT 1 FROM sub_flags s
                       WHERE s."projectId" = b.id AND s.prepared))       AS "inPrepared"
FROM board b;

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
  CALL pg_temp.must_equal(r."toBuyLines", 0, 'a draft has no frozen lines to buy');
  CALL pg_temp.must_equal(r."onOrderLines", 0, 'nor any on order');
  CALL pg_temp.must_equal(
    r."inOffers" OR r."inOrdered" OR r."inPreparation" OR r."inPrepared", false,
    'a draft is in the Projects column only');
  CALL pg_temp.must_equal(json_array_length(r.products), 2,
    'but its pinned products travel with the card');
  CALL pg_temp.must_equal(r.products->0->>'sku', 'TEST025-FC',
    'products are listed by position, not insert order');
END $$;

-- ---------------------------------------------------------------------------
-- 3. The two buying counts, and that they overlap
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250002;
  -- Strictly greater, both of them: line 6 (missing 2 = ordered 2, ordered 2
  -- = received 2) and line 7 (all zeros) are in neither count, which is what
  -- stops a line that owes nothing from reading as outstanding.
  CALL pg_temp.must_equal(r."toBuyLines",   2, 'toBuyLines: missing above ordered');
  CALL pg_temp.must_equal(r."onOrderLines", 2, 'onOrderLines: ordered above received');
  CALL pg_temp.must_equal(r."inOffers" AND r."inOrdered", true,
    'one project can be in Offers and Ordered at once — the counts overlap');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Preparation is per sub-product (migration 026)
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  -- Base: 4 diodes needed, 4 held, none picked yet -> a card with work to do.
  SELECT * INTO r FROM sub_flags
   WHERE "projectProductId" = 9250020 AND "subProductRevisionId" = 9250001;
  CALL pg_temp.must_equal(r."requiredQty", 4, 'requiredQty is qty_per_unit x the project quantity');
  CALL pg_temp.must_equal(r."pickedQty",   0, 'nothing picked yet');
  CALL pg_temp.must_equal(r."readyPartCount", r."partCount",
    'every line is coverable, so the card reports nothing short');
  CALL pg_temp.must_equal(r."inPreparation", true, 'and it belongs in Preparation');

  -- Cover: 10 screws needed, none held, none picked -> nothing to do today,
  -- so no card. This is the half of the rule that `pickedQty > 0` cannot
  -- cover, and the one an inverted comparison would silently flip.
  SELECT * INTO r FROM sub_flags
   WHERE "projectProductId" = 9250020 AND "subProductRevisionId" = 9250002;
  CALL pg_temp.must_equal(r."pickablePartCount", 0, 'nothing of Cover can be picked today');
  CALL pg_temp.must_equal(r."readyPartCount", 0, 'and its line reads short');
  CALL pg_temp.must_equal(r."inPreparation", false,
    'a sub-product with nothing to do and nothing done puts no card on the board');
END $$;

-- ---------------------------------------------------------------------------
-- 5. A project sits in Preparation AND Prepared at once (§8.1)
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250003;
  CALL pg_temp.must_equal(r."inPrepared", true,
    'one finished sub-product is enough to reach Prepared');
  CALL pg_temp.must_equal(r."inPreparation", true,
    'and the unfinished one keeps the project in Preparation at the same time');

  -- The unfinished one is held there by its picks alone: every line is full,
  -- so nothing is pickable, and a rule counting only pickable lines would drop
  -- the card — and the modal with it — with the parts still in the box.
  SELECT * INTO r FROM sub_flags
   WHERE "projectProductId" = 9250030 AND "subProductRevisionId" = 9250002;
  CALL pg_temp.must_equal(r."pickablePartCount", 0, 'nothing left to pick on Cover');
  CALL pg_temp.must_equal(r."pickedQty" = r."requiredQty", true, 'because it is full');
  CALL pg_temp.must_equal(r."inPreparation", true,
    'a full but unmarked list stays on the board — picked_qty > 0 is what holds it');
END $$;

-- ---------------------------------------------------------------------------
-- 6. prepared_qty is the sum of the picks behind it
-- ---------------------------------------------------------------------------

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*)::int INTO n
    FROM project_parts pp
    JOIN (SELECT project_part_id, SUM(picked_qty) AS picked
            FROM project_part_usages GROUP BY project_part_id) u
      ON u.project_part_id = pp.id
   WHERE pp.project_id BETWEEN 9250001 AND 9250006
     AND pp.prepared_qty <> u.picked;
  CALL pg_temp.must_equal(n, 0,
    'every fixture part with pick lines has prepared_qty = the sum of them');
END $$;

-- ---------------------------------------------------------------------------
-- 7. A stopped project sits in Projects alone, however its lines read
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM sub_flags
   WHERE "projectProductId" = 9250040 AND "subProductRevisionId" = 9250001;
  CALL pg_temp.must_equal(r."inPreparation", true,
    'the stopped project''s sub-product still reads as having work to do');

  SELECT * INTO r FROM flags WHERE id = 9250004;
  CALL pg_temp.must_equal(r."toBuyLines" > 0, true, 'and its lines still look outstanding');
  CALL pg_temp.must_equal(
    r."inOffers" OR r."inOrdered" OR r."inPreparation" OR r."inPrepared", false,
    'yet a stopped project sits in the Projects column alone');
END $$;

-- ---------------------------------------------------------------------------
-- 8. A completed project still reaches Prepared (§3.1)
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM flags WHERE id = 9250005;
  CALL pg_temp.must_equal(r."inPrepared", true, 'a completed project is in Prepared');
END $$;

-- ---------------------------------------------------------------------------
-- 9. A started project with nothing frozen under it never reads as prepared
--
-- The replacement for the old `doneLines >= required_qty` floor. That floor
-- existed because every sourcing comparison is an equality when all four
-- columns are zero, so a project that had obtained nothing counted as done.
-- Membership now comes off the sub-product rows instead, and a project with
-- none of them has nothing to be done — which has to be a different answer
-- from "finished", or the card reads 100% having obtained nothing.
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record; n integer;
BEGIN
  SELECT count(*)::int INTO n FROM sub_flags WHERE "projectId" = 9250006;
  CALL pg_temp.must_equal(n, 0, 'the unsourced project has no sub-product rows');

  SELECT * INTO r FROM flags WHERE id = 9250006;
  CALL pg_temp.must_equal(r.derived, true, 'it is started, so it can reach a derived column');
  CALL pg_temp.must_equal(r."inPrepared", false, 'but it is not prepared');
  CALL pg_temp.must_equal(r."inPreparation", false, 'and there is nothing to prepare');
END $$;

-- ---------------------------------------------------------------------------
-- 10. The filters: each one drops out when its parameter is null, which is
--     what lets one statement serve the board list and a single-card re-read.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*)::int INTO n FROM projects
   WHERE status = ANY(ARRAY['draft','started']::text[]) AND name ILIKE '%TEST025%';
  CALL pg_temp.must_equal(n, 4, 'the default draft+started filter hides stopped and completed');

  SELECT count(*)::int INTO n FROM projects
   WHERE (NULL::text[] IS NULL OR status = ANY(NULL::text[]))
     AND (ARRAY[9250004]::int[] IS NULL OR id = ANY(ARRAY[9250004]::int[]));
  CALL pg_temp.must_equal(n, 1,
    'an id filter with no status filter reads one card whatever status it has');
END $$;

ROLLBACK;

\echo 'ALL ASSERTIONS PASSED'
