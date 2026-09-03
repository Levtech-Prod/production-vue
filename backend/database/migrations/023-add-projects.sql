-- Migration 023 — Projects: the frozen BOM, the offer grid, and orders
-- (projects-preparation-plan.md §3).
--
-- A project pins product REVISIONS, then freezes their flattened BOM into
-- `project_parts` — one row per distinct part in the whole project — with
-- `project_part_usages` remembering every place that quantity came from. The
-- freeze is what makes the numbers stable: a draft sub-product revision's
-- parts can still be edited after the project started, so re-deriving live
-- would silently disagree with the stored `required_qty`.
--
-- `project_parts` carries NO status column, only quantities that add up:
--
--                     ┌─ from_stock_qty ─────────────┐
--   required_qty  ────┤                              ├──> prepared_qty
--                     └─ missing_qty ─> ordered_qty ─> received_qty
--
-- A part is routinely both partly in stock and partly short, and the shortfall
-- can be split across suppliers arriving on different days; one enum value
-- cannot say that, quantities can. The three CHECK constraints below keep the
-- buckets ordered, so no service has to remember the invariant.
--
-- What this file deliberately does NOT enforce: `ordered_qty`, `received_qty`
-- and `prepared_qty` are sums the service maintains, so cancelling an order or
-- removing a product from a project leaves them stale unless the same
-- transaction adjusts them — the database will not notice. And
-- `missing_qty DEFAULT 0` means a freeze that dies between its two statements
-- reads as "nothing to buy" rather than as an obvious error.
--
-- Same conventions as the rest of the schema: SERIAL PKs, CHECK constraints
-- instead of Postgres enums, `updated_at` set explicitly by the API, no
-- triggers or functions. Mirrored into schema.sql in the same change.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/023-add-projects.sql
-- (idempotent — safe to re-run)

BEGIN;

-- ===========================================================================
-- 1. Projects
-- ===========================================================================
-- `status` is the whole edit/delete/stop rule: draft is editable and
-- deletable, started is neither and may only be stopped, stopped and
-- completed are terminal. Names are deliberately not unique — two jobs for
-- the same customer legitimately share one.

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  deadline    DATE,
  status      VARCHAR(20) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'started', 'stopped', 'completed')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at  TIMESTAMPTZ,
  stopped_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- ===========================================================================
-- 2. Which products the project contains
-- ===========================================================================

-- Lets the composite FK below prove the revision belongs to the product.
CREATE UNIQUE INDEX IF NOT EXISTS product_revisions_id_product_unique
  ON product_revisions (id, product_id);

-- The composite FK is the cheap way to make "revision 7 belongs to product 3"
-- un-representable, instead of validating it in the service and hoping every
-- future writer remembers.
CREATE TABLE IF NOT EXISTS project_products (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  product_revision_id INTEGER NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  position            INT NOT NULL DEFAULT 0,
  -- Permits the same product twice at different revisions.
  UNIQUE (project_id, product_revision_id),
  FOREIGN KEY (product_revision_id, product_id)
    REFERENCES product_revisions (id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_project_products_project_id
  ON project_products(project_id);

-- ===========================================================================
-- 3. The frozen, flattened BOM
-- ===========================================================================
-- One row per PART per project — the part appears once even when several
-- products need it, which is what the Parts table on the Projects page asks
-- for. `required_qty` is the project's demand; `missing_qty` may deliberately
-- exceed `required_qty - from_stock_qty` when the buyer tops up the shelf, so
-- any cost or consumption figure for the project must use `required_qty`.

CREATE TABLE IF NOT EXISTS project_parts (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  part_id        INTEGER NOT NULL REFERENCES parts(id),

  -- Total needed by the project: SUM(bom qty x project_products.quantity).
  -- PRECONDITION: `sub_product_revision_parts.quantity` carries no CHECK of
  -- its own, so zero and negative BOM lines are representable today. Any that
  -- exist will make the freeze fail here rather than be silently rounded up.
  -- `SELECT * FROM sub_product_revision_parts WHERE quantity <= 0` must come
  -- back empty before the freeze (story 5) is switched on.
  required_qty   NUMERIC(12,3) NOT NULL CHECK (required_qty > 0),
  -- Claim on stock that already exists. Seeded to MIN(required_qty, free stock).
  from_stock_qty NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (from_stock_qty >= 0),
  -- Decided purchase quantity. Seeded to required_qty - from_stock_qty, then
  -- editable upward (the surplus lands in stock on receipt) and downward, but
  -- never below what has already been ordered.
  missing_qty    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  -- True once the user has typed over the seeded value, so "Recalculate from
  -- stock" never discards a purchasing decision.
  missing_qty_overridden BOOLEAN NOT NULL DEFAULT FALSE,

  -- Progress. Denormalised sums of order_lines and of preparation picks,
  -- written in the same transaction as the event they summarise — exactly as
  -- stock_entries.quantity_consumed already is.
  ordered_qty    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (ordered_qty >= 0),
  received_qty   NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  prepared_qty   NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (prepared_qty >= 0),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, part_id),

  -- FK targets, not business rules: `id` is already the PK, so these are
  -- trivially unique. They exist so `order_lines` and `project_offer_prices`
  -- can prove in the database that a row they point at belongs to the same
  -- project (and the same part) they claim — the same device as the composite
  -- FK on project_products. Two indexes rather than one because a FK must
  -- match a unique constraint on exactly its own columns; a prefix will not do.
  UNIQUE (id, project_id),
  UNIQUE (id, project_id, part_id),

  -- WRITE ORDER MATTERS. Postgres CHECKs are evaluated per row per statement
  -- and cannot be deferred, so any change that moves quantity BETWEEN these
  -- columns must set them in ONE `UPDATE`. Lowering missing_qty in one
  -- statement and raising from_stock_qty in the next fails on the first,
  -- even inside a transaction that would have ended in a legal state.
  CONSTRAINT chk_project_parts_ordered_within_missing
    CHECK (ordered_qty <= missing_qty),
  CONSTRAINT chk_project_parts_received_within_ordered
    CHECK (received_qty <= ordered_qty),
  CONSTRAINT chk_project_parts_prepared_within_pickable
    CHECK (prepared_qty <= from_stock_qty + received_qty)
);

CREATE INDEX IF NOT EXISTS idx_project_parts_project_id ON project_parts(project_id);
-- Drives the cross-project "reserved quantity" aggregate: only lines with an
-- outstanding claim on physical stock are in the index.
CREATE INDEX IF NOT EXISTS idx_project_parts_part_id
  ON project_parts(part_id) WHERE prepared_qty < from_stock_qty + received_qty;

-- ===========================================================================
-- 4. Where each part is used
-- ===========================================================================
-- One row per PLACE the part is actually used — a (product-in-the-project,
-- sub-product revision) pair, not just a product. The obvious alternative, a
-- nullable sub_product_revision_id with one row per product, cannot represent
-- the ordinary case of a part sitting in two sub-products of one product.
--
-- Neither the FK to `parts` (above) nor the one to `sub_product_revisions`
-- carries an ON DELETE clause, so neither can be removed while a project still
-- claims it — the same protection `sub_product_revision_parts` already gives.

CREATE TABLE IF NOT EXISTS project_part_usages (
  id                      SERIAL PRIMARY KEY,
  project_part_id         INTEGER NOT NULL REFERENCES project_parts(id) ON DELETE CASCADE,
  project_product_id      INTEGER NOT NULL REFERENCES project_products(id) ON DELETE CASCADE,
  -- Which sub-product of that product the part sits in. Nothing in phases 1-2
  -- reads it; Preparation builds its pick lists from it, and backfilling it
  -- later would mean re-reading revisions that may have moved.
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id),
  qty_per_unit            NUMERIC(12,3) NOT NULL CHECK (qty_per_unit > 0),
  UNIQUE (project_part_id, project_product_id, sub_product_revision_id)
);

CREATE INDEX IF NOT EXISTS idx_project_part_usages_project_product
  ON project_part_usages(project_product_id);

-- ===========================================================================
-- 5. Offers
-- ===========================================================================
-- No "offer round" entity — the sheet IS the project's current quote grid.
-- Companies are the dynamic columns, prices the cells.
--
-- A missing row and a NULL price mean the same thing (no quote); the API
-- writes a row only when the salesman types something, and a cleared cell
-- deletes its row. Zero is a real, distinct value — a free part.
--
-- Best price is NOT stored: it is MIN(price_per_piece) over a row's non-null
-- cells, computed in the frontend from the grid it already holds. A stored
-- "is_best" flag would need rewriting on every keystroke.

CREATE TABLE IF NOT EXISTS project_offer_companies (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, company_id),
  -- FK target for project_offer_prices (see project_parts above).
  UNIQUE (id, project_id)
);

-- `project_id` is denormalised, but it cannot drift: both composite FKs below
-- read it, so a cell pairing one project's company column with another
-- project's part is un-representable rather than merely discouraged.
CREATE TABLE IF NOT EXISTS project_offer_prices (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER NOT NULL,
  offer_company_id  INTEGER NOT NULL,
  project_part_id   INTEGER NOT NULL,
  -- Canonical EUR, NULL = this company did not quote this part.
  price_per_piece   NUMERIC(12,4) CHECK (price_per_piece >= 0),
  entered_amount    NUMERIC(12,4),
  entered_currency  CHAR(3) NOT NULL DEFAULT 'EUR' CHECK (entered_currency IN ('EUR','RON')),
  rate_used         NUMERIC(18,6),
  rate_date         DATE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (offer_company_id, project_part_id),
  FOREIGN KEY (offer_company_id, project_id)
    REFERENCES project_offer_companies (id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (project_part_id, project_id)
    REFERENCES project_parts (id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_offer_prices_part
  ON project_offer_prices(project_part_id);

-- ===========================================================================
-- 6. Orders
-- ===========================================================================
-- One order per company per "Order Parts" action — the same click can place
-- three orders at three suppliers, which is what lets parts be ordered
-- separately from different companies.
--
-- Placing an order adds its line quantities to project_parts.ordered_qty in
-- the same transaction; receiving adds to order_lines.received_qty and
-- project_parts.received_qty, and writes an ordinary stock_entries row of
-- type = 'received' through the existing machinery, so the FIFO layer,
-- weighted average price and currency provenance keep working untouched.
-- Both writes are partial-safe: ordering 3 of 8 leaves 5 still quotable.

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  order_number VARCHAR(60),
  status       VARCHAR(20) NOT NULL DEFAULT 'ordered'
                 CHECK (status IN ('ordered','partially_received','received','cancelled')),
  note         TEXT,
  expected_at  DATE,
  ordered_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ordered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- FK target for order_lines (see project_parts above).
  UNIQUE (id, project_id)
);

-- `part_id` is denormalised from project_parts so receiving can write its
-- stock_entries row without a join; the composite FK below is what stops it
-- disagreeing with the project_part it came from. Getting that wrong would
-- credit stock to the wrong part, which is the one error here that corrupts
-- data outside the projects module. `project_id` is denormalised for the same
-- reason and held true by the same means.
CREATE TABLE IF NOT EXISTS order_lines (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL,
  project_id      INTEGER NOT NULL,
  project_part_id INTEGER NOT NULL,
  part_id         INTEGER NOT NULL REFERENCES parts(id),
  quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  -- Copied from the accepted offer cell (canonical EUR) so a later re-quote
  -- cannot rewrite the price of an order already placed.
  price_per_piece NUMERIC(12,4),
  received_qty    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  UNIQUE (order_id, project_part_id),
  FOREIGN KEY (order_id, project_id)
    REFERENCES orders (id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (project_part_id, project_id, part_id)
    REFERENCES project_parts (id, project_id, part_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON order_lines(order_id);
-- project_parts does not cascade into order_lines, so deleting one has to scan
-- for referencing lines; without this that is a sequential scan per part.
CREATE INDEX IF NOT EXISTS idx_order_lines_project_part_id
  ON order_lines(project_part_id);

COMMIT;
