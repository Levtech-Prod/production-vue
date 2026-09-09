# Projects Preparation — implementation plan

Status: planning. Nothing below is built yet.

A new top-level module that turns *products* (which the app already models and
revisions) into *projects*: a named job containing one or more main products,
whose combined BOM is split into "order this" and "pick this from stock", then
driven through offers, orders and preparation.

Scope of this plan: the **Projects** page and the **Offer Processing** page,
plus the schema and API that the later pages need so they are not a migration
away. **Orders** and **Preparation** pages and the **Project details** page are
designed for but deliberately not built in phase 1 (see §9).

---

## 1. Decisions

Settled up front, because each one changes the data model:

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | How a project references its products | `product_id` + **pinned** `product_revision_id` + `quantity` | The BOM must be frozen. A new default revision published mid-project must not silently rewrite a running project's parts list. |
| 1b | Start granularity | The **whole project** at once; `status` lives on `projects` | One card per project per column, and one freeze transaction. Per-product starts would move `status` onto `project_products` and reshape the board (§8.2). |
| 2 | How Kanban cards reach a column | **Derived** from per-part quantities, never dragged | The board can then never contradict the data. "One project in several columns at once" falls out for free: a project is in *Offers* if ≥1 of its part lines is being quoted, and in *Preparation* if ≥1 is pickable from stock. |
| 3 | When stock is reserved | On **project start** | A started project has a real claim on the shelf; a draft does not. Reserving at creation would lock stock for projects that never run; reserving only at Preparation lets two projects both plan on the same screws. |
| 4 | Offer scope | **Per project** | Matches the screen: pick a project, quote its to-order BOM. Cross-project RFQ pooling is a later feature, not a schema change (see §10). |

Three more that follow from the above:

- **No `stock_reservations` table.** The reserved quantity of a part is
  `SUM(from_stock_qty + received_qty - prepared_qty)` over *started* projects —
  what they have earmarked but not yet picked. A separate table would hold
  exactly that number a second time and could drift from it. One partial index
  on `project_parts(part_id)` makes the aggregate cheap.
- **`project_parts` is materialised at Start, and computed live before it.**
  A *draft* project's parts are derived on every read, so a salesman can see
  what a job needs before committing to it. From Start onward the rows are
  persisted, because four things must then outlive the derivation: the editable
  purchase quantity, the ordered/received/prepared progress, the reserved
  amount, and immunity to someone editing a draft sub-product revision's parts
  after the project started. One service produces both (§5.3).
- **No status enums on a BOM line.** Every state is a comparison of
  quantities, because a line is routinely part-ordered and part-received and an
  enum holds one value (§3.3).

---

## 2. What already exists and is reused

| Need | Existing thing |
|---|---|
| Flatten a product revision into parts | `GET /api/product-revisions/:revId/bom` and its SQL in `backend/src/routes/productRevisions.ts` — the freeze service reuses the query shape, not the endpoint. |
| Available stock (FIFO) | `stock_entries.quantity - quantity_consumed` over `type = 'received'`; mirrored on the frontend by `frontend/src/utils/stock.ts` (`availableOf`, `summarizeStock`). |
| Supplier list | `companies` table + `companiesStore` / `companiesAPI`. |
| Money in two currencies | Canonical EUR column + `entered_amount` / `entered_currency` / `rate_used` / `rate_date` provenance (migration 011) and `services/exchangeRates.convertToEur`. Offer prices follow the same shape. |
| PDF export with Hungarian glyphs | `frontend/src/views/products/detail/bom/bomPdf.ts` (Roboto registration, thumbnail rasterising) and `composables/useBomPdfExport.ts`. |
| Per-selection fetch + cache + stale-response guard | `composables/useScopedCache.ts` — written for exactly this "right-hand panel follows the selection" shape. |
| Confirm-then-act flow | `composables/useConfirmDelete.ts` + `components/notification/ConfirmModal.vue` / `DeleteConfirmModal.vue`. |
| Change history | `services/audit.ts` (`logAudit`, `diffFields`) — entity-agnostic, so `project` is just another entity name. |
| Error contract | `backend/src/errorCodes.ts` + `errors.<CODE>` i18n keys. |

**Reuse as-is, don't copy:** `useConfirmDelete` is already a generic "pick a
target, confirm, run an async action" flow, so the Stop-project confirmation
uses it unchanged — no near-identical composable. Its *name* is the only
mismatch; renaming it to `useConfirmAction` would touch two working call sites
for no behaviour change, so leave that as a separate tidy-up if it ever
bothers anyone (§11.4).

---

## 3. Data model — `backend/database/migrations/023-add-projects.sql`

Same conventions as the rest of the schema: `SERIAL` PKs, `CHECK` constraints
instead of Postgres enums, `updated_at` set explicitly by the API, every
statement idempotent. Mirror the new tables into `schema.sql` in the same
change.

### 3.1 Projects

```sql
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
```

`status` is the whole edit/delete/stop rule:

| status | edit | delete | stop | on the board |
|---|---|---|---|---|
| `draft` | yes | yes | — | *Projects* column only |
| `started` | no | no | yes | *Projects* + every derived column |
| `stopped` | no | no | — | *Projects*, greyed; reservations released |
| `completed` | no | no | — | *Prepared* |

Names are not unique — two jobs for the same customer legitimately share one.

### 3.2 Which products the project contains

```sql
-- Lets the composite FK below prove the revision belongs to the product.
CREATE UNIQUE INDEX IF NOT EXISTS product_revisions_id_product_unique
  ON product_revisions (id, product_id);

CREATE TABLE IF NOT EXISTS project_products (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  product_revision_id INTEGER NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  position            INT NOT NULL DEFAULT 0,
  UNIQUE (project_id, product_revision_id),
  FOREIGN KEY (product_revision_id, product_id)
    REFERENCES product_revisions (id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_project_products_project_id
  ON project_products(project_id);
```

The composite FK is the cheap way to make "revision 7 belongs to product 3"
un-representable, instead of validating it in the service and hoping every
future writer remembers.

### 3.3 The frozen, flattened BOM

One row per **part** per project — the part appears once even when several
products need it, which is exactly what the Parts table at the bottom of the
Projects page asks for.

```sql
CREATE TABLE IF NOT EXISTS project_parts (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  part_id        INTEGER NOT NULL REFERENCES parts(id),

  -- Total needed by the project: SUM(bom qty x project_products.quantity).
  -- PRECONDITION: `sub_product_revision_parts.quantity` carries no CHECK of
  -- its own, so zero and negative BOM lines are representable today. Any that
  -- exist make the freeze fail here rather than be silently rounded up.
  required_qty   INTEGER NOT NULL CHECK (required_qty > 0),
  -- Claim on stock that already exists. Seeded to MIN(required_qty, free stock).
  from_stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (from_stock_qty >= 0),
  -- Decided purchase quantity. Seeded to required_qty - from_stock_qty, then
  -- editable upward (the surplus lands in stock on receipt) and downward, but
  -- never below what has already been ordered.
  missing_qty    INTEGER NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  -- True once the user has typed over the seeded value, so "Recalculate from
  -- stock" (§5.2) never discards a purchasing decision.
  missing_qty_overridden BOOLEAN NOT NULL DEFAULT FALSE,

  -- Progress. Denormalised sums of order_lines and of preparation picks,
  -- written in the same transaction as the event they summarise — exactly as
  -- stock_entries.quantity_consumed already is.
  ordered_qty    INTEGER NOT NULL DEFAULT 0 CHECK (ordered_qty >= 0),
  received_qty   INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  prepared_qty   INTEGER NOT NULL DEFAULT 0 CHECK (prepared_qty >= 0),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, part_id),

  -- FK targets, not business rules: `id` is already the PK, so these are
  -- trivially unique. They let `order_lines` and `project_offer_prices` prove
  -- in the database that a row they point at belongs to the same project (and
  -- the same part) they claim — the device §3.2 already uses. Two indexes
  -- rather than one because a FK must match a unique constraint on exactly its
  -- own columns; a prefix will not do.
  UNIQUE (id, project_id),
  UNIQUE (id, project_id, part_id),

  -- WRITE ORDER MATTERS — see below.
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
```

**Whole parts.** Every quantity above is `INTEGER` (migration 025): half a
part cannot be needed, bought, received or picked. The BOM line these are
computed from (`sub_product_revision_parts.quantity`) is `INTEGER` for the same
reason, and `stock_entries` carries a whole-number CHECK, so free stock — which
seeds `from_stock_qty` — cannot arrive as a fraction either. Note what an
`INTEGER` column does and does not give: it **rounds** 1.5 rather than refusing
it, so the refusal lives at the API boundary (`schemas/parts.schema.ts`
validates a BOM line with `z.number().int()`), and any endpoint that later
accepts a quantity — story 8's `missingQty`, story 15's order lines — must do
the same or it becomes the way a fraction gets in. In return the service does
no rounding at all: integers are exact in JS to 2^53, and the columns arrive as
numbers instead of NUMERIC strings.

**Quantities, not status enums.** A part is routinely *both* partly in stock
and partly short — 3 on the shelf, 5 to buy — and the 5 can be ordered 2 from
one company and 3 from another, arriving on different days. A status column
holds one value and cannot say any of that: the moment the first of two orders
is placed the line would read `ordered` and the outstanding 3 would vanish from
the Offer page. Quantities compose; enum states do not. So the row carries no
state column at all, only numbers that add up:

```
                    ┌─ from_stock_qty ─────────────┐
required_qty  ──────┤                              ├──> prepared_qty
                    └─ missing_qty ─> ordered_qty ─> received_qty
```

Every status in the UI is then a comparison, and every one of them is also a
*count*, which is what lets a card show progress instead of a binary:

| meaning | condition | outstanding amount |
|---|---|---|
| still to quote / buy | `missing_qty > ordered_qty` | `missing_qty - ordered_qty` |
| on order, not arrived | `ordered_qty > received_qty` | `ordered_qty - received_qty` |
| pickable, not picked | `from_stock_qty + received_qty > prepared_qty` | that difference |
| line settled | none of the above | — |

Three CHECK constraints keep the buckets ordered (`ordered <= missing`,
`received <= ordered`, `prepared <= from_stock + received`), so no service can
leave the row in an inconsistent state.

**One invariant does survive for the service to remember, and it is not
optional.** Postgres evaluates CHECKs per row per statement and cannot defer
them, so any change that moves quantity *between* these columns must set them
in a single `UPDATE`. Lowering `missing_qty` in one statement and raising
`from_stock_qty` in the next fails on the first, inside a transaction that
would have ended perfectly legal. This bites "Recalculate from stock" (§5.2)
directly, since moving quantity between those two columns is exactly what it
does. Received goods need no column
rewriting to become pickable: they are pickable because `received_qty` counts
toward the pick.

`required_qty` is the project's demand; `missing_qty` may deliberately exceed
`required_qty - from_stock_qty` when the buyer tops up the shelf. **Any cost or
consumption figure for the project must use `required_qty`, never
`missing_qty`** — the surplus, `missing_qty - (required_qty - from_stock_qty)`,
belongs to stock, not to the job.

### 3.4 Where each part is used

**The rule: `project_parts` holds one row per *distinct part in the whole
project*.** A part used by three of the project's products is still one row,
with one summed `required_qty`. `project_part_usages` is the junction that
remembers where that quantity came from — **one row per place the part is
actually used**, which is a (product-in-the-project, sub-product revision)
pair, not just a product.

```sql
CREATE TABLE IF NOT EXISTS project_part_usages (
  id                      SERIAL PRIMARY KEY,
  project_part_id         INTEGER NOT NULL REFERENCES project_parts(id) ON DELETE CASCADE,
  project_product_id      INTEGER NOT NULL REFERENCES project_products(id) ON DELETE CASCADE,
  -- Which sub-product of that product the part sits in. Nothing in phases 1-2
  -- reads it; Preparation (phase 3) builds its pick lists from it, and
  -- backfilling it later would mean re-reading revisions that may have moved.
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id),
  qty_per_unit            INTEGER NOT NULL CHECK (qty_per_unit > 0),
  UNIQUE (project_part_id, project_product_id, sub_product_revision_id)
);

CREATE INDEX IF NOT EXISTS idx_project_part_usages_project_product
  ON project_part_usages(project_product_id);
```

**Why the grain is the usage site and not the product.** The obvious version of
this table carries a nullable `sub_product_revision_id` alongside one row per
product — and it cannot represent the ordinary case where a part sits in *two*
sub-products of the same product (the screws below). One usage, one row; the
per-product and per-project figures are then sums, and nothing is lost.

So a part appears in exactly one row of `project_parts` and in **as many rows
of `project_part_usages` as there are places it is used** — one for a part
fitted in a single sub-product of a single product, five for a part fitted in
two sub-products of one product and three of another.

#### Worked example

Project "Line A" contains two main products:

| project_product | product | pinned revision | quantity |
|---|---|---|---|
| PP1 | `CTRL-100` | R3 | 2 |
| PP2 | `PSU-200`  | R1 | 3 |

Their frozen compositions, for **one unit** of each product:

| product | sub-product revision | part | qty |
|---|---|---|---|
| CTRL-100 R3 | Front panel rev B | Screw M3 | 2 |
| CTRL-100 R3 | Base rev A | Screw M3 | 2 |
| CTRL-100 R3 | Base rev A | Relay 5V | 1 |
| PSU-200 R1 | PSU board rev C | Screw M3 | 6 |
| PSU-200 R1 | PSU board rev C | Capacitor 100µF | 2 |

`project_part_usages` — five rows, one per line of that table:

| project_part | project_product | sub-product revision | qty_per_unit |
|---|---|---|---|
| Screw M3 | PP1 | Front panel rev B | 2 |
| Screw M3 | PP1 | Base rev A | 2 |
| Screw M3 | PP2 | PSU board rev C | 6 |
| Relay 5V | PP1 | Base rev A | 1 |
| Capacitor 100µF | PP2 | PSU board rev C | 2 |

`project_parts` — three rows, one per distinct part:

| part | required_qty | how it was computed |
|---|---|---|
| Screw M3 | **26** | `(2 + 2) × 2` (CTRL) `+ 6 × 3` (PSU) = 8 + 18 |
| Relay 5V | **2** | `1 × 2` |
| Capacitor 100µF | **6** | `2 × 3` |

And the Parts table at the bottom of the Projects page renders exactly that:

| Part name | SKU | Products | Qty |
|---|---|---|---|
| Screw M3 | `SCR-M3` | `CTRL-100`, `PSU-200` | 26 |
| Relay 5V | `RLY-5V` | `CTRL-100` | 2 |
| Capacitor 100µF | `CAP-100U` | `PSU-200` | 6 |

The *Products* cell is that part's usage rows collapsed to distinct products —
one SKU chip for a single-product part, several for a shared one, which is the
requirement "display the part once in the table and list the Product SKUs in
that column". Phase 3's Preparation page reads the *same* rows without
collapsing them, and gets "Front panel rev B: 2, Base rev A: 2" for free.

#### Three levels, in order

| level | grain | where it lives |
|---|---|---|
| 1 | one usage: (product, sub-product revision, part) | stored, `project_part_usages.qty_per_unit` |
| 2 | per product: `SUM(qty_per_unit)` over its usages | computed (4 screws per CTRL-100) |
| 3 | per project: `SUM(level 2 × project_products.quantity)` | stored, `project_parts.required_qty` |

Only levels 1 and 3 are persisted. Level 2 is a `GROUP BY` in the read query,
because it is the level nothing else depends on.

The whole freeze is one insert-from-select, no per-part loop:

```sql
WITH usage AS (
  SELECT
    pp.id                        AS project_product_id,
    prsp.sub_product_revision_id,
    sprp.part_id,
    sprp.quantity                AS qty_per_unit,
    sprp.quantity * pp.quantity  AS qty_for_project
  FROM project_products pp
  JOIN product_revision_sub_products prsp
    ON prsp.product_revision_id = pp.product_revision_id
  JOIN sub_product_revision_parts sprp
    ON sprp.sub_product_revision_id = prsp.sub_product_revision_id
  WHERE pp.project_id = $1
),
inserted AS (
  INSERT INTO project_parts (project_id, part_id, required_qty)
  SELECT $1, part_id, SUM(qty_for_project)
  FROM usage
  GROUP BY part_id
  RETURNING id, part_id
)
INSERT INTO project_part_usages
  (project_part_id, project_product_id, sub_product_revision_id, qty_per_unit)
SELECT i.id, u.project_product_id, u.sub_product_revision_id, u.qty_per_unit
FROM usage u
JOIN inserted i ON i.part_id = u.part_id;
```

No `GROUP BY` is needed inside `usage`: `sub_product_revision_parts` is already
unique on `(sub_product_revision_id, part_id)`, and
`product_revision_sub_products` is unique on
`(product_revision_id, sub_product_revision_id)`, so every row is a distinct
usage site. (`from_stock_qty` / `missing_qty` are set in a second statement,
once free stock has been read for all the part ids at once — §5.3.)

#### Edge cases this shape handles

- **A part in two sub-products of one product.** Two usage rows, summed at
  level 2. The nullable-column version of this table could not say it at all.
- **Same product twice at different revisions.** `UNIQUE(project_id,
  product_revision_id)` permits `CTRL-100 R3` *and* `CTRL-100 R4` as two
  `project_products` rows. A shared part then produces usage rows under the
  same SKU, so the Products cell must label chips with the revision
  (`CTRL-100 · R3`) whenever the project contains a product more than once.
- **Alternative parts.** `part_alternatives` links are *not* collapsed here —
  `SCR-M3` and its alternate are distinct `parts` rows and stay distinct
  `project_parts` rows. Substituting one for the other is a purchasing decision
  on the Offer page, not a BOM-freeze decision.
- **A part, or a sub-product revision, deleted later.** Both FKs have no
  `ON DELETE` clause, so neither can be removed while a project still claims
  it — the same protection `sub_product_revision_parts` already gives. Note
  this also blocks deleting the owning *sub-product* (whose cascade would try
  to take its revisions with it); that needs the same friendly error as
  `PART_IN_USE_BY_PROJECT`.

Why store the usages at all, when they are derivable from the pinned revisions?
Because a *draft* sub-product revision's parts can still be edited after the
project started. Re-deriving live would silently disagree with the frozen
`required_qty`; the junction is what keeps the snapshot internally consistent.

### 3.5 Offers

No "offer round" entity — the sheet *is* the project's current quote grid.
Companies are the dynamic columns; prices are the cells.

```sql
CREATE TABLE IF NOT EXISTS project_offer_companies (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, company_id),
  -- FK target for project_offer_prices (see §3.3).
  UNIQUE (id, project_id)
);

CREATE TABLE IF NOT EXISTS project_offer_prices (
  id                SERIAL PRIMARY KEY,
  -- Denormalised, but it cannot drift: both composite FKs below read it.
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
```

- A missing row and a `NULL` price mean the same thing (no quote); the API
  writes a row only when the salesman types something, and a cleared cell
  deletes its row. Zero is a real, distinct value — a free part.
- **Best price is not stored.** It is `MIN(price_per_piece)` over the row's
  non-null cells, computed in the frontend from the grid it already holds. A
  stored "is_best" flag would need rewriting on every keystroke.

### 3.6 Orders

The Orders *page* is phase 2, but step 8 of the brief ("if a part is ordered
its status becomes ordered and it appears on Orders") means the tables must
exist now — the order is created from the Offer Processing page.

```sql
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
  -- FK target for order_lines (see §3.3).
  UNIQUE (id, project_id)
);

CREATE TABLE IF NOT EXISTS order_lines (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL,
  -- Denormalised, held true by the composite FKs below.
  project_id      INTEGER NOT NULL,
  project_part_id INTEGER NOT NULL,
  part_id         INTEGER NOT NULL REFERENCES parts(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  -- Copied from the accepted offer cell (canonical EUR) so a later re-quote
  -- cannot rewrite the price of an order already placed.
  price_per_piece NUMERIC(12,4),
  received_qty    INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
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
```

One order per company per "Order Parts" action — the same click can place three
orders at three suppliers, which is precisely the requirement that parts be
orderable separately from different companies.

**Why `order_lines` carries `project_id` and `part_id` it could have joined
for.** Both are denormalised for the writer's convenience — receiving needs the
part to write its `stock_entries` row without a join. Denormalised copies that
nothing checks are how a line ends up crediting stock to the wrong part, which
is the one error in this module that corrupts data *outside* it. So both are
covered by composite FKs back to `project_parts`, exactly as §3.2 covers
`product_revision_id`: an order line whose `part_id` contradicts its
`project_part`, or whose `project_part` belongs to a different project than its
order, is un-representable rather than merely discouraged. `project_offer_prices`
carries `project_id` for the same reason — without it a price cell can pair one
project's company column with another project's part.

This is the general rule the module follows: **wherever a row points at two
things that must agree, the agreement is a composite FK, not a service check.**

Placing an order adds its line quantities to `project_parts.ordered_qty` in the
same transaction; receiving (phase 2) adds to `order_lines.received_qty` and
`project_parts.received_qty`, and writes an ordinary `stock_entries` row of
`type = 'received'` through the existing machinery, so the FIFO layer, weighted
average price and currency provenance all keep working untouched. Both writes
are partial-safe: ordering 3 of 8 leaves 5 still quotable, receiving 2 of 3
leaves 1 on order.

**The surplus problem solves itself:** the whole received quantity enters
stock, the project consumes only `required_qty`, and the difference is simply
stock on hand.

---

## 4. The two computed things

### 4.1 Board membership

No column is stored. One query returns, per project, which columns it belongs
in:

```sql
SELECT
  p.id,
  p.name,
  p.status,
  p.deadline,
  COUNT(pp.id)                                                    AS "lineCount",
  COUNT(*) FILTER (WHERE pp.missing_qty  > pp.ordered_qty)        AS "toBuyLines",
  COUNT(*) FILTER (WHERE pp.ordered_qty  > pp.received_qty)       AS "onOrderLines",
  COUNT(*) FILTER (WHERE pp.from_stock_qty + pp.received_qty
                       > pp.prepared_qty)                         AS "toPickLines"
FROM projects p
LEFT JOIN project_parts pp ON pp.project_id = p.id
WHERE $1::boolean OR p.status <> 'stopped'   -- $1 = include stopped
GROUP BY p.id
ORDER BY p.created_at DESC;
```

Column membership is read off those counts, in the API rather than in SQL so
the rule lives in one readable place:

```
inOffers      = toBuyLines    > 0
inOrdered     = onOrderLines  > 0
inPreparation = toPickLines   > 0
inPrepared    = lineCount > 0 AND toBuyLines + onOrderLines + toPickLines = 0
```

Note the asymmetry, and it is deliberate: the middle three columns are **any**
("some parts still need buying"), *Prepared* is **all** ("nothing is
outstanding any more"). A card in *Prepared* while half the BOM is still on
order would mean nothing. The *Projects* column is every project, always, per
the brief.

Returning the counts rather than four booleans costs nothing and gives each
card its progress figure — "12 of 40 parts to buy" — which matters precisely
because *Prepared* stays dark until the very last line closes.

### 4.2 Stock numbers for the Parts table

```sql
-- Available: the existing FIFO rule, unchanged.
SELECT part_id, SUM(quantity - quantity_consumed) AS available
FROM stock_entries
WHERE type = 'received' AND part_id = ANY($1)
GROUP BY part_id;

-- Reserved by OTHER started projects: the outstanding claim on physical
-- stock, i.e. what a project has earmarked but not yet picked. Received
-- goods count too — they are sitting in stock with this project's name on
-- them, so they must not be promised twice.
SELECT part_id, SUM(from_stock_qty + received_qty - prepared_qty) AS reserved
FROM project_parts pp
JOIN projects pr ON pr.id = pp.project_id
WHERE pp.part_id = ANY($1)
  AND pp.project_id <> $2
  AND pp.prepared_qty < pp.from_stock_qty + pp.received_qty
  AND pr.status = 'started'
GROUP BY pp.part_id;
```

`services/projectStock.ts`'s `getPartStock` runs both queries above as CTEs inside one statement rather than two separate round trips, so `available` and `reserved` always come from the same snapshot — see §11.8 for why. `getAvailableQuantities` / `getReservedQuantities` stay available separately, unchanged, for callers that only need one side.

Free stock, used when seeding `from_stock_qty` at project start, is
`available - reserved`. A stopped project drops out of the aggregate
automatically, which is the whole reason there is no reservations table to
release.

**These claims can go stale, and the plan does not pretend otherwise.**
`from_stock_qty` is fixed at start; if someone then removes stock by hand, the
sum of all claims can exceed what is on the shelf. Chasing that with
recalculation would fight the user. Instead it is surfaced: the Parts table
flags any row where `available < reserved + (from_stock_qty - prepared_qty)`,
and the Preparation page (phase 3) refuses a pick that would drive stock
negative. The stale claim is a real-world event — someone took the parts — and
showing it is more useful than silently rewriting numbers.

---

## 5. Backend

### 5.1 Files

```
backend/src/routes/projects.ts           -> /api/projects
backend/src/routes/projectOffers.ts      -> /api/projects/:id/offer/*
backend/src/routes/orders.ts             -> /api/orders        (thin in phase 1)
backend/src/schemas/projects.schema.ts
backend/src/schemas/projectOffers.schema.ts
backend/src/schemas/orders.schema.ts
backend/src/services/projectBom.ts       -- freeze / re-seed the flattened BOM
backend/src/services/projectStock.ts     -- available + reserved per part
```

Registered in `server.ts` next to the existing `app.use('/api/...')` block.

### 5.2 Endpoints

**Projects**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/projects` | Board payload (§4.1). `?status=` (repeatable; defaults to `draft,started` — see §6.3) and `?q=` for a name search. |
| `POST` | `/api/projects` | `{ name, description?, deadline?, products: [{ productId, productRevisionId, quantity }] }`. Creates as `draft`. |
| `GET` | `/api/projects/:id` | Project + its products (name, SKU, revision label, qty). |
| `PATCH` | `/api/projects/:id` | Replaces fields *and* the product set. `409 PROJECT_NOT_EDITABLE` unless `draft`. |
| `DELETE` | `/api/projects/:id` | `409 PROJECT_NOT_EDITABLE` unless `draft`. |
| `POST` | `/api/projects/:id/start` | Persist the BOM the user is already looking at, seed the quantity buckets, `status = 'started'`. |
| `POST` | `/api/projects/:id/stop` | `status = 'stopped'`, `stopped_at = NOW()`. |
| `GET` | `/api/projects/:id/parts` | The Parts table rows (§5.4). **Works for a draft**: computed live from the pinned revisions, `draft: true` in the response. For a started project it reads `project_parts`. Same payload shape either way. |
| `PATCH` | `/api/projects/:id/parts/:projectPartId` | `{ missingQty?, fromStockQty? }`. Started projects only. `missingQty` is clamped to `>= ordered_qty`, else `409 MISSING_QTY_BELOW_ORDERED`. Sets `missing_qty_overridden`. |
| `POST` | `/api/projects/:id/parts/recalculate` | Re-seeds `from_stock_qty` / `missing_qty` from today's free stock for rows where `missing_qty_overridden = false`, and never below `ordered_qty`. Returns the rows it changed and the ones it skipped, so the UI can say why. |

**Offers**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/projects/offer-queue` | Left-hand list: started projects with ≥1 line where `missing_qty > ordered_qty`, newest first. |
| `GET` | `/api/projects/:id/offer` | `{ companies: [...], rows: [{ projectPartId, part, quantity, referencePrice, prices: { [offerCompanyId]: money } }] }`. `referencePrice` is the hint below. |
| `POST` | `/api/projects/:id/offer/companies` | `{ companyId }` — adds a column. `409 OFFER_COMPANY_ALREADY_ADDED`. |
| `DELETE` | `/api/projects/:id/offer/companies/:offerCompanyId` | Drops the column and its prices. Refused with `409 OFFER_COMPANY_IN_USE` when an order for this project already exists at that company (`orders.project_id = :id AND orders.company_id = ...`) — `order_lines` needs no link back to the offer column for this. |
| `PUT` | `/api/projects/:id/offer/prices` | Bulk upsert `[{ offerCompanyId, projectPartId, amount, currency }]`; `amount: null` deletes the cell. One transaction, one round trip for a whole edited column. |
| `POST` | `/api/projects/:id/orders` | `{ lines: [{ projectPartId, offerCompanyId, quantity }], orderNumber?, expectedAt?, note? }`. Groups lines by company, creates one `orders` row per company, and **adds** each quantity to `project_parts.ordered_qty` (never assigns) so a part can be ordered across several orders. Rejects a line that would push `ordered_qty` past `missing_qty` with `409 ORDER_QUANTITY_EXCEEDS_MISSING`. |

`referencePrice` answers "is this quote any good?" without leaving the page.
It is the last price actually paid for the part, falling back to the most
recent quote from another project when it has never been bought — two
`DISTINCT ON` queries over the whole page's part ids at once, never per row:

```sql
-- Preferred: what we last paid, and to whom.
SELECT DISTINCT ON (se.part_id)
       se.part_id, se.price_per_piece, se.entered_at::date AS on_date, c.name AS company
FROM stock_entries se
JOIN companies c ON c.id = se.company_id
WHERE se.type = 'received' AND se.part_id = ANY($1)
ORDER BY se.part_id, se.entered_at DESC;

-- Fallback: the newest quote from any OTHER project.
SELECT DISTINCT ON (pp.part_id)
       pp.part_id, pop.price_per_piece, pop.updated_at::date AS on_date, c.name AS company
FROM project_offer_prices pop
JOIN project_parts pp           ON pp.id  = pop.project_part_id
JOIN project_offer_companies poc ON poc.id = pop.offer_company_id
JOIN companies c                 ON c.id   = poc.company_id
WHERE pop.price_per_piece IS NOT NULL
  AND pp.part_id = ANY($1)
  AND pp.project_id <> $2
ORDER BY pp.part_id, pop.updated_at DESC;
```

Both are covered by existing indexes (`idx_stock_entries_part_id`,
`idx_project_offer_prices_part`). No new tables, and it is the cheapest partial
answer to the cross-project price question that decision 4 deferred.

**Orders** (phase 1 = enough to prove the write worked)

| Method | Path |
|---|---|
| `GET` | `/api/orders?projectId=` |
| `GET` | `/api/orders/:id` |

### 5.3 `services/projectBom.ts` — compute, freeze, re-seed

Three exported functions over one piece of logic. The important one is the
first, and it is deliberately not tied to starting a project:

**`computeProjectBom(projectId)` — no writes.** Runs the two-level aggregation
of §3.4 against the pinned revisions and returns the rows in memory, with
`from_stock_qty` / `missing_qty` seeded from today's free stock. This is what
`GET /:id/parts` serves for a **draft** project, so a salesman can see exactly
what a job will need — and what will have to be bought — *before* committing to
it. That is the moment the number matters most, and without this the main table
on the page would be empty for precisely the projects still being decided.

**`freezeProjectBom(client, projectId)`** runs inside the `start` transaction
and persists what the user was already looking at:

1. `computeProjectBom`, re-run inside the transaction (never trusting numbers
   the browser sent back).
2. Insert `project_parts` with
   `from_stock_qty = MIN(required_qty, MAX(0, available - reserved))`,
   `missing_qty = required_qty - from_stock_qty`, and the three progress
   buckets at 0.
3. Insert `project_part_usages` (§3.4).
4. Free stock is read **once** for every part id in one `ANY($1)` query — never
   per part.
5. Wrap the whole thing in a `pg_advisory_xact_lock` on a fixed key so two
   projects started in the same second cannot both claim the last five
   capacitors. This serialises project starts globally; at a handful of starts
   a day that is a simplicity decision, not a scalability one.

**`reseedFromStock(client, projectId)`** backs
`POST /:id/parts/recalculate`. Weeks pass between starting a project and
placing the order, and stock moves in between. It recomputes free stock and
rewrites `from_stock_qty` / `missing_qty` for rows where
`missing_qty_overridden = false`, clamping `missing_qty` to at least
`ordered_qty`, and reports which rows it left alone. This is also what makes
`missing_qty_overridden` worth its column: without a re-seed, the flag guards
against something that never happens.

A project with no products, or whose products' revisions have no parts, is
refused with `PROJECT_HAS_NO_PARTS` rather than started empty.

### 5.4 Parts table payload

```ts
interface ProjectPartRow {
  id: number | null;          // project_parts.id; null while the project is a
                              // draft and the row is computed, not stored.
                              // Rows are keyed on `part.id`, which both forms
                              // have (§11.10).
  part: { id: number; name: string; code: string; image: string | null;
          categoryId: number; categoryName: string };
  // The part's usage rows collapsed to distinct products: a single entry for
  // a part used by one product, several for a shared part. The sum of
  // `qtyForProduct` always equals `requiredQty`. Preparation (phase 3) reads
  // the same rows uncollapsed, per sub-product.
  products: {
    projectProductId: number;
    productId: number;
    sku: string;
    revisionLabel: string;   // shown on the chip only when the project
                             // contains the same product more than once
    qtyPerUnit: number;      // per one unit of that product
    qtyForProduct: number;   // qtyPerUnit x that product's project quantity
  }[];
  requiredQty: number;
  availableQty: number;       // total in stock, all projects
  reservedQty: number;        // other started projects' outstanding claims
  fromStockQty: number;
  missingQty: number;
  missingQtyOverridden: boolean;
  orderedQty: number;
  receivedQty: number;
  preparedQty: number;
  // Derived server-side so the table and the board agree by construction.
  toBuyQty: number;           // missingQty - orderedQty
  onOrderQty: number;         // orderedQty - receivedQty
  toPickQty: number;          // fromStockQty + receivedQty - preparedQty
  // available < reserved + this project's own outstanding claim: someone has
  // taken stock this project was counting on.
  stockShortfall: boolean;
}
```

For a draft project the response is `{ draft: true, rows: [...] }` with the
progress buckets all zero — the rows are computed, not stored (§5.3).

`categoryName` ships with every row because the table's only filter is a part
category search — doing it client-side avoids a round trip per keystroke.

`qtyForProduct` is computed in the query, not stored — it lets the Products
cell show the breakdown on hover (`26 = CTRL-100 8 + PSU-200 18`) without a
second request, and makes a wrong `requiredQty` visible rather than silent.

### 5.5 Error codes to add

`INVALID_PROJECT_ID`, `PROJECT_NOT_FOUND`, `PROJECT_NOT_EDITABLE`,
`PROJECT_ALREADY_STARTED`, `PROJECT_NOT_STARTED`, `PROJECT_HAS_NO_PRODUCTS`,
`PROJECT_HAS_NO_PARTS`, `PRODUCT_REVISION_MISMATCH`, `PROJECT_PART_NOT_FOUND`,
`OFFER_COMPANY_ALREADY_ADDED`, `OFFER_COMPANY_IN_USE`, `OFFER_PRICE_MISSING`,
`ORDER_QUANTITY_EXCEEDS_MISSING`, `MISSING_QTY_BELOW_ORDERED`,
`PROJECT_PARTS_NOT_FROZEN`, `ORDER_NOT_FOUND`, and — on the existing parts
route, because `project_parts.part_id` now blocks the delete —
`PART_IN_USE_BY_PROJECT`. Each with an
`errors.<CODE>` entry in `frontend/src/i18n/index.ts`.

### 5.6 Audit

`logAudit` with `entity: 'project'` on create / update / start / stop / delete,
and on `missing_qty` overrides — the last one is the field a purchasing dispute
will be about. Reuse `diffFields`; no new audit machinery.

---

## 6. Frontend

### 6.1 Navigation

`Sidebar.vue` currently renders a flat `items` array with an optional `section`
heading — there is no nested group yet, so this is genuinely new. Extend the
item shape rather than forking the component:

```ts
interface NavItem {
  to: string;
  label: string;
  icon: Component;
  section?: string;
  children?: { to: string; label: string }[];
}
```

- A group renders as a `RouterLink` to its own root (`/projects-preparation`),
  which **redirects to `/projects-preparation/projects`** — that is how
  "clicking Projects Preparation opens Projects by default" is implemented, in
  the router rather than in a click handler.
- The group auto-expands when `route.path.startsWith(item.to)`; the manual
  open/closed state lives in `uiStore` beside `sidebarCollapsed`, so it
  survives navigation.
- Collapsed sidebar: the icon still navigates to the root on click, same as
  every other item, but hovering it opens a flyout listing the children
  (including the two disabled entries, tooltipped the same way as inline).
  Revised after shipping story 2 — without it, Offer Processing has no way to
  be reached while the sidebar is collapsed. This is the first hover menu in
  the app; kept deliberately minimal (no nested groups, no keyboard handling)
  since it only ever holds one level of children.

Routes:

```ts
{ path: '/projects-preparation', redirect: '/projects-preparation/projects' },
{ path: '/projects-preparation/projects',    component: ProjectsView,        meta: { auth: true, titleKey: 'projects' } },
{ path: '/projects-preparation/offers',      component: OfferProcessingView, meta: { auth: true, titleKey: 'offer_processing' } },
{ path: '/projects-preparation/orders',      component: OrdersView,          meta: { auth: true, titleKey: 'orders' } },
{ path: '/projects-preparation/preparation', component: PreparationView,     meta: { auth: true, titleKey: 'preparation' } },
{ path: '/projects-preparation/projects/:id', component: ProjectDetailView,
  meta: { auth: true, back: { to: '/projects-preparation/projects', labelKey: 'projects' } } },
```

Only the two routes that phase 1 and 2 implement are registered. **Orders and
Preparation appear in the menu from day one but disabled and tooltipped
("coming soon"), with no route and no view** — shipping three empty components
would be dead code, which CLAUDE.md forbids, and a menu item that navigates to
a blank page is worse than one that visibly is not ready yet. Each becomes a
real `RouterLink` in the phase that builds it. The project-detail route is
added in phase 3 with its view. Not admin-gated: this is salesman/warehouse
work, unlike `/stock/*`.

### 6.2 Files

```
frontend/src/views/projects/
  ProjectsView.vue              board + parts table, owns the selection
  ProjectModal.vue              add/edit project (name, description, deadline, products)
  ProjectProductsEditor.vue     rows of product + revision + quantity inside the modal
  ProjectPartsTable.vue         the bottom table
  board/
    ProjectBoard.vue            the five columns
    ProjectBoardColumn.vue
    ProjectCard.vue
  offers/
    OfferProcessingView.vue     project list (left) + grid (right)
    OfferProjectList.vue
    OfferGrid.vue               fixed columns + dynamic company columns
    OfferCompanyModal.vue       pick a company to add as a column
    OrderPartsModal.vue         choose part -> company, review, place
    offerPdf.ts                 builds the export doc

frontend/src/api/projectsAPI.ts, projectOffersAPI.ts, ordersAPI.ts
frontend/src/stores/projectsStore.ts, projectOffersStore.ts
frontend/src/types/projects.ts, projectOffers.ts, orders.ts
frontend/src/composables/useTableSort.ts            new, shared by the two new tables
```

### 6.3 Projects page behaviour

- `ProjectsView` owns `selectedProjectId`. Nothing selected: every card shows
  and the Parts table is hidden. Selected: the board dims cards of other
  projects (they stay visible so the board keeps its shape) and the Parts table
  loads.
- **The board is filtered by default.** Thirty live projects across five
  columns is over a hundred cards, and the *Projects* column would grow forever
  as finished jobs accumulate. Default to `draft` + `started`, with a small
  status filter (and a name search) above the board to bring back stopped and
  completed ones. The filter lives in the query string so a filtered board is a
  shareable link.
- The Parts table fetch goes through **`useScopedCache`** keyed on the selected
  project id — that composable exists precisely for "fetch per scope, cache per
  scope, never let a slow response overwrite a newer selection", and the
  product detail page already proves the pattern. Because it caches per project, the
  entry must be dropped on every write that moves the rows — editing the
  project, Start, a Missing-quantity edit, Recalculate from stock — or the
  table keeps showing the BOM from before. There is no server-side cache to
  fall back on: a draft is recomputed per request on purpose (§11.10).
- A **draft** project shows the same table, computed live (§5.3), read-only,
  under a "not started — quantities are indicative" note. Selecting a draft and
  seeing what it will cost to buy is the whole point of the page before Start.
- Cards are read-only tiles: project name, product count, a per-column badge
  (e.g. "4 parts"), deadline. Clicking any card selects that project. Cards are
  **not draggable** — per decision 2 the column is a fact about the data.
- Actions on the *Projects* column card only: Edit / Delete while `draft`,
  Start while `draft`, Stop while `started`. Delete and Stop go through
  `useConfirmDelete`, used unchanged for both, with `DeleteConfirmModal` /
  `ConfirmModal`.
- `ProjectModal` reuses the product picker idea from
  `views/products/detail/AddPartsModal.vue` /
  `views/products/PartsPicker.vue`; check those
  before writing a new search-and-add list. Revision defaults to the product's
  `default_revision_id` and is changeable.

### 6.4 Parts table

Columns: part name | SKU | Products (SKU chips) | Required | Available |
Reserved | Missing (editable) | Ordered | Received.

The last two are read-only progress, and they are why Missing must never be
edited below Ordered — the row would then owe less than it has already bought.
The input clamps client-side and the API rejects it anyway
(`MISSING_QTY_BELOW_ORDERED`).

- Sorting on every column and a part-category search box, both client-side —
  a project BOM is hundreds of rows, not thousands.
- The sort lives in a new `useTableSort<T>(rows, accessors)` composable used by
  this table and the offer grid. `PartsTable.vue`'s existing sort is *not*
  refactored into it: that one sorts by a category-parameter id against
  `stock_parameters` values, a different decision that happens to look similar.
- Missing qty is an inline `PriceInput`-style numeric field (reuse
  `utils/numberInput.ts`), debounced, `PATCH`ing the single row. Editing it
  above the shortfall is legal and expected.
- A **Recalculate from stock** button above the table
  (`POST /:id/parts/recalculate`), with a confirm that says how many rows will
  change and how many are skipped as overridden. Stock moves between starting a
  project and buying for it; without this the seeded numbers quietly rot.
- Row highlight when `toBuyQty > 0` and the project has no offer columns yet —
  the "nobody has requested a quote for this" state. A second, warning-coloured
  highlight when `stockShortfall` is true.

### 6.5 Offer Processing page

- Left: projects with at least one line still to buy
  (`missing_qty > ordered_qty`), newest first, single-select. Right: the grid,
  again behind `useScopedCache`.
- Fixed columns: image (reuse the thumbnail rendering from `PartsTable.vue`),
  part name, SKU, quantity (editable -> `PATCH .../parts/:id` -> the *same*
  `missing_qty` the Projects page edits; there is one number, shown twice),
  and a greyed **reference price** (§5.2: last paid, else last quoted, with
  company and date). Without it a quote is a number with nothing to judge it
  against; with it the buyer sees "0.51 € vs 0.42 € paid in March" at a glance.
  Read-only, never counted as an offer, excluded from best-price and export.
- **The image, part name and SKU columns are sticky.** Past three or four
  companies the grid scrolls horizontally, and a price typed into the wrong row
  is worse than no price at all.
- Dynamic columns: one per `project_offer_companies` row, header shows company
  name + a remove button. "Add company" opens `OfferCompanyModal` over
  `companiesStore` (which already caches the list) and can create a new company
  inline, as the stock entry form does.
- Each cell is a money input in EUR or RON, following `PriceInput.vue` and the
  same canonical-EUR-plus-provenance contract as `stock_entries`. Cells flush
  in a batched `PUT` on blur, not per keystroke.
- **Paste a column from Excel.** Suppliers answer an RFQ with a spreadsheet;
  without this, someone retypes two hundred prices per company per project and
  will quietly go on doing the whole job in Excel instead. Handle `paste` on a
  company column: split the clipboard text on newlines, map values to the rows
  in their current sort order starting at the focused cell, ignore blanks,
  accept both `1,23` and `1.23`, and show a preview ("47 prices will be
  written, 3 rows skipped as non-numeric") before committing in one `PUT`. This
  is the single highest-value item on the page and it is roughly a day.
- **Keyboard entry.** Enter and ↓ move down the column, ↑ up, Tab across,
  Esc reverts the cell. A column of prices is otherwise two hundred mouse
  clicks — paste covers the spreadsheet case, this covers the phone-call case.
- Best price per row: `MIN` over non-null cells, highlighted; ties highlight
  all winners. Purely computed in the component.
- **A footer row per company column: quoted coverage and basket total** —
  "34 / 40 parts · 1 240 €", where the total is
  `SUM(price x that row's quantity)` over the rows that company quoted.
  Cheapest per piece is not the buying decision; a supplier who quotes 34 of 40
  parts slightly above another who quotes 9 usually wins the order. Computed in
  the component from the grid it already holds, and it re-uses the same
  quantity the Order Parts modal will use, so the two totals cannot disagree.
- Sorting: part name, SKU, quantity, and **each company column** (asc/desc,
  nulls last regardless of direction — an absent quote is not "cheap").
- Export: a checkbox column, all checked by default, and an Export PDF button.
  `offerPdf.ts` reuses the Roboto registration and thumbnail rasteriser from
  `bom/bomPdf.ts` — extract those two helpers into a shared
  `utils/pdfDoc.ts` rather than copying them, and point `bomPdf.ts` at it in
  the same change. Landscape, one column per company.
- Order Parts: `OrderPartsModal` lists the selected rows with a company
  dropdown per row, pre-selected to the best price; the footer shows the
  resulting orders grouped by company with totals; confirming posts once to
  `POST /api/projects/:id/orders`. Ordered lines leave the grid and the project
  card appears in *Ordered*.

### 6.6 i18n

All new labels go into `frontend/src/i18n/index.ts` under the existing groups
(`errors`, `success`, `confirmations`, top-level UI). Hungarian and English
both, matching the current file.

---

## 7. Implementation order

Each step ends with something demonstrable. Steps within a phase are ordered by
dependency, not by size.

### Phase 0 — foundations (no visible feature)

1. **Migration `023-add-projects.sql`** with every table in §3, mirrored into
   `schema.sql`. Run against a copy of production first: the only risky
   statement is the new unique index on `product_revisions (id, product_id)`,
   which must already hold.
2. **Error codes + i18n keys** (§5.5). Cheap, and doing it first stops every
   later step inventing ad-hoc messages.
3. **Sidebar nested group + the Projects and Offer Processing routes**, with
   Orders and Preparation shown as disabled menu entries (§6.1). Ship this on
   its own: it is the one change that touches shared chrome, and reviewing it
   apart from the feature work is much easier. After this step the menu shows
   the whole module and every later step fills in one page.

### Phase 1 — Projects page

4. **`services/projectStock.ts`** — available + reserved per part, with the two
   `ANY($1)` queries from §4.2. Independently testable, needed by both the
   freeze and the Parts table.
5. **`routes/projects.ts` CRUD** — list (board payload), create, read, update,
   delete, with Zod schemas and the `draft`-only guard. No parts yet.
6. **Frontend: board without the parts table** — `projectsStore`,
   `ProjectsView`, `ProjectBoard`, `ProjectCard`, `ProjectModal`,
   `ProjectProductsEditor`, plus the status filter and name search (§6.3).
   Only the *Projects* column has cards; the other four render empty.
   Delete/edit guards visible.
   *Demo point: create, edit and delete a project with products.*
7. **`services/projectBom.ts::computeProjectBom` + `GET /:id/parts`** — the
   read-only, live-computed BOM. Deliberately before Start: it is the harder
   half of the logic, it is testable on a draft with no state to unwind, and it
   is what the next step persists.
8. **`freezeProjectBom` + `POST /:id/start` + `POST /:id/stop`**, including the
   advisory lock. Starting now persists exactly the rows step 7 already shows,
   and the derived columns light up.
9. **`PATCH /:id/parts/:id`** (with the `>= ordered_qty` clamp) **and
   `POST /:id/parts/recalculate`.**
10. **`useTableSort` + `ProjectPartsTable`**, wired through `useScopedCache`,
    with category search, the editable missing quantity, the read-only Ordered
    / Received columns, the shortfall warning and the Recalculate button.
    *Demo point: the whole Projects page as specified, drafts included.*

### Phase 2 — Offer Processing

11. **`utils/pdfDoc.ts` extraction** — pull the font registration and thumbnail
    rasteriser out of `bom/bomPdf.ts` and repoint it. A standalone refactor
    with no behaviour change, in its own commit, verified by exporting a BOM
    with Hungarian part names before and after.
12. **`routes/projectOffers.ts`** — queue, grid read (including the
    `referencePrice` pair of `DISTINCT ON` queries), company add/remove, bulk
    price upsert. Prices go through `convertToEur` exactly as stock entries do.
13. **`OfferProcessingView` + `OfferProjectList` + `OfferGrid`** with dynamic
    columns, sticky identity columns, editable cells, keyboard navigation,
    best-price marking, the reference-price hint, per-column sorting and the
    per-company coverage/basket footer. The sticky columns and the keyboard
    handling are cheap here and retrofit badly, so they belong in this step
    rather than a polish pass.
14. **Paste a column from Excel** (§6.5) — on its own, right after the grid
    exists, because everything about the page's usability turns on it.
15. **Export**: selection checkboxes + `offerPdf.ts`.
16. **`orders` / `order_lines` writes**: `POST /api/projects/:id/orders`,
    `OrderPartsModal`, and the additive `ordered_qty` bump that moves the card
    to the *Ordered* column while leaving any un-ordered remainder quotable.
    *Demo point: quote, compare, export, order — including a part split across
    two suppliers.*

### Phase 3 — deferred, designed for

17. **Project details page** — the products, their frozen revisions, the BOM
    per product, history from `audit_logs`, and progress per column.
18. **Orders page** — the list, receiving against `order_lines`, writing
    `stock_entries`, and the `received_qty` bump that makes an arrival
    pickable (§3.3).
19. **Preparation page** — pick lists per project, writing the `removed`
    `stock_entries`, bumping `prepared_qty`, and `projects.status ->
    'completed'` when every line's buckets settle.

**Suggested branch/ticket split:** 1–3 as one ticket (schema + chrome), then
4–6, 7–10, 11–15, 16 — five tickets for phases 0–2, matching the existing
`LP-xx-topic` branch convention.

---

## 8. Open questions

All five are settled, struck through and kept for the record with the reasoning
that produced each. None of them turned out to need a change to migration 023.

1. ~~**Prepared column semantics.**~~ **Settled at step 6: all-lines-done, as
   the plan had it.** Decided while looking at real cards, and the board is
   what settled it. Under "≥1 part is picked and ready" a project would sit in
   *Preparation* and *Prepared* simultaneously for almost its whole life —
   *Preparation* is already the ANY test over the same quantities, so the two
   columns would light up together and neither would tell you anything. Under
   all-lines-done, *Prepared* is the one column that means "nothing is
   outstanding", and the per-card counts (§4.1) carry the progress that would
   otherwise justify an early *Prepared*: the *Preparation* card reads
   "7 to pick" and empties as they are picked. Still nothing stored, so this
   stays a one-line change if it ever proves wrong.
2. ~~**Does a project always start whole?**~~ **Settled: yes.** `status` stays
   on `projects`; Start freezes every product's BOM together and the board is
   one card per project per column. Making products start independently later
   means moving `status` to `project_products` and reshaping the board — a
   migration, knowingly accepted.
3. ~~**Sub-product level.**~~ **Settled: recorded.** The junction is
   `project_part_usages`, grained per (product, sub-product revision, part), so
   Preparation can build per-sub-product pick lists without re-reading
   revisions that may have moved (§3.4). Nothing in phases 1–2 reads
   `sub_product_revision_id`; it is written at freeze time and left alone.
4. ~~**Stopped project, open orders.**~~ **Settled at step 8: leave the orders
   alone.** Stopping already releases the stock claims — they drop out of the
   §4.2 aggregate — and the open orders are exactly the part the app cannot
   undo, which is the reason not to pretend otherwise. Cancelling a supplier
   order is a phone call; writing `orders.status = 'cancelled'` would record an
   outcome the app has no way to know, and the goods would arrive anyway
   against a line that says they were cancelled. Refusing to stop is worse
   still: it withholds the stock release at the one moment the job is off, and
   a slow supplier would hold a dead project `started` for weeks.

   So `POST /:id/stop` takes no body and carries no orders branch. The goods
   arrive, land in stock through the normal receipt, and are unreserved,
   because the project claiming them has already left the aggregate. What
   story 15 adds is a *count* on the Stop confirmation — "3 open orders will
   still be delivered" — so the user knows what they are leaving running, not
   a branch in the endpoint. If cancelling ever needs recording, it belongs on
   the order as its own action, not as a side effect of stopping a project.

5. ~~**Who may do what.**~~ **Settled: every logged-in user.** The whole
   Projects Preparation module — project CRUD, Start, Stop, editing
   quantities, recalculating, quoting and placing orders — is `requireAuth`
   with no `requireAdmin` anywhere, and no new role column. This is
   warehouse and sales work, not configuration, which is also why §6.1 leaves
   the routes un-gated while `/stock/*` stays admin-only.

   One existing endpoint has to change for that to actually work:
   **`POST /api/companies` relaxes from `requireAuth, requireAdmin` to
   `requireAuth`**, so a salesman can add a supplier that is not in the list
   yet while quoting (§6.5). `DELETE /api/companies/:id` **stays admin-only** —
   creating a supplier name is harmless and reversible, removing one that
   stock entries and orders point at is not. Do this in the same story as the
   offer API (§7 step 12) so the change arrives with the feature that needs it,
   and update `frontend/src/views/parts/AddStockForm.vue` if it hides its
   inline company creation behind an admin check.

   Everything else already works: every `GET` in `parts`, `part-categories`,
   `products` and `product-revisions` is `requireAuth` today, so only the
   writes are admin-gated and the new module never needs those.

---

## 9. Deliberately not built

- Drag-and-drop on the board (decision 2).
- A reservations table (§1).
- Cross-project RFQ pooling. The grid is keyed `(project, part, company)`; a
  future pooled RFQ is a second screen reading the same
  `project_parts.missing_qty`, not a migration. The reference-price hint
  (§5.2) covers the cheap part of the benefit meanwhile — the buyer sees what
  the part last cost, even if the demand is not combined into one RFQ.
- Offer rounds / quote history. If re-quoting must be auditable, add a
  `round` integer to `project_offer_companies` later; nothing here forecloses
  it.
- Emailing offers. Export is a PDF the salesman sends himself.

---

## 10. Review against the project rules

- **Reuse first:** the BOM flatten query, FIFO stock math, `companies`,
  `convertToEur`, `useScopedCache`, `useConfirmDelete`, `PriceInput`,
  `numberInput`, `ConfirmModal`/`DeleteConfirmModal`, `logAudit` and the PDF
  font handling are all existing code this plan calls into. Two new shared
  pieces are proposed (`useTableSort`, `utils/pdfDoc.ts`) and both are
  extractions with more than one caller on day one.
- **Not overengineered:** no reservations table, no offer-round entity, no
  stored best-price flag, no board-placement table, no triggers, no enums, no
  computed columns — every one of those was considered and rejected above with
  the reason.
- **Schema rules:** one migration file, idempotent, mirrored into `schema.sql`,
  `CHECK` constraints not enums, `updated_at` written by the API.
- **Type/validation rules:** every request body and query param gets a Zod
  schema at the boundary; every query is parameterised; no `any` in the payload
  types.

---

## 11. Review log

### 11.1 Folded into the plan above (second pass)

Six problems found by re-reading §§1–10 adversarially. All are now applied;
they are listed here so a reader can see *why* the design looks the way it
does, not only what it is.

| # | Problem | Where it is now handled |
|---|---|---|
| A1 | `procure_state` / `prepare_state` enums could not express a part-ordered or part-received line — the first of two orders would hide the outstanding remainder from the Offer page. | §3.3 replaces both enums with `ordered_qty` / `received_qty` / `prepared_qty` and three CHECKs; §4.1 derives the board from comparisons and returns counts. |
| A2 | A draft project showed an empty Parts table — exactly when the numbers matter most. | §5.3 `computeProjectBom`, §5.2 `GET /:id/parts`, §6.3. |
| A3 | `missing_qty` could be edited below what was already ordered. | §5.2 clamp + `MISSING_QTY_BELOW_ORDERED`; §6.4. |
| A6 | "Refused if an order cites it" was unimplementable — `order_lines` has no offer-company link. | §5.2 checks `orders.project_id` + `orders.company_id`; no schema change. |
| B1 | No way to paste a supplier's spreadsheet into a company column. | §6.5, and its own step (§7 step 14). |
| B6 | `missing_qty_overridden` guarded a re-seed that did not exist. | §5.2 `POST /:id/parts/recalculate`, §5.3 `reseedFromStock`, §6.4. |

Two further findings were folded in as behaviour rather than structure: stale
stock claims are now **detected and shown** rather than silently corrected
(§4.2), and `missing_qty` is documented as *not* the project's demand — cost
figures must use `required_qty` (§3.3).

### 11.2 Folded in on the third pass

The five usability items previously parked here are now in the plan:

| item | where |
|---|---|
| Per-company coverage + basket total in the grid footer | §6.5, §7 step 13 |
| Keyboard entry (Enter/↓/↑/Tab/Esc) in the grid | §6.5, §7 step 13 |
| Sticky image / name / SKU columns | §6.5, §7 step 13 |
| Reference price per part (last paid, else last quoted) | §5.2 with its two `DISTINCT ON` queries, §6.5, §7 step 12 |
| Board status filter + name search, defaulting to draft + started | §5.2, §6.3, §7 step 6 |

None of them needed a schema change, which is the reason they could wait until
after the structural review and still be folded in cleanly. The reference price
is also the cheapest partial answer to the cross-project pricing question that
decision 4 deferred: it does not pool demand, but it stops the same part being
quoted blind in two projects a month apart.

### 11.3 Fourth pass — consistency sweep and the two settled questions

Re-read end to end after three rounds of patching. Three places had drifted out
of agreement with the review log and are now fixed in the body: §2 recommended
renaming `useConfirmDelete` while §11.4 rejected it; §6.1/§6.2/§7 step 3
shipped placeholder views that §11.4 calls dead code; `PART_IN_USE_BY_PROJECT`
was named in the risks but missing from §5.5.

Then §8.2 and §8.3 were answered, and the second answer had a consequence worth
recording. "Add a nullable `sub_product_revision_id`" cannot express the
ordinary case in this plan's own worked example — a screw fitted in *two*
sub-products of the same product. One nullable column holds one value. So the
junction changed grain rather than gaining a column: `project_part_products`
became **`project_part_usages`**, one row per (product, sub-product revision,
part), with the per-product figure becoming a `GROUP BY` instead of a stored
number (§3.4). Same row count for simple BOMs, correct for real ones, and it
hands Preparation its per-sub-product pick list for free.

### 11.4 Deliberately rejected on review

- **Three placeholder views** for Orders / Preparation / project detail would
  ship dead code, which CLAUDE.md forbids. §6.1 and §7 step 3 now show the two
  unbuilt entries as disabled menu items instead, each becoming a real route in
  the phase that implements it.
- **Renaming `useConfirmDelete` to `useConfirmAction`** — it already works
  unchanged for Stop, so the rename is cosmetic and touches two working call
  sites during the riskiest phase. §2 and §6.3 now use it as-is. Do the rename
  separately, or not at all.

### 11.5 Risks to check before step 1

- The new `UNIQUE (id, product_id)` on `product_revisions` will hold (`id` is
  the PK), but the index build takes a brief lock — run it in the migration
  window.
- `project_parts.part_id` has no `ON DELETE`, so deleting a part used by any
  project now fails. `DELETE /api/parts/:id` needs a `PART_IN_USE_BY_PROJECT`
  code and a friendly message, or someone hits a raw 500.
- Extracting `utils/pdfDoc.ts` touches the **working** BOM export — own commit,
  manual before/after check with Hungarian part names (§7 step 11).
- `projects.status = 'completed'` has no writer until phase 3. Harmless, but do
  not let a reviewer assume something sets it.
- **`CHECK (required_qty > 0)` depends on data, not only on schema.**
  `sub_product_revision_parts.quantity` has no CHECK of its own, so zero and
  negative BOM lines are legal today. Run
  `SELECT * FROM sub_product_revision_parts WHERE quantity <= 0` against
  **production** before step 5; any row it returns makes the freeze fail on
  every project that uses it. This is part of what the §7 step 0 spike is for.
- **The CHECK constraints on `project_parts` are not deferrable.** Any write
  that moves quantity between `from_stock_qty`, `missing_qty`, `ordered_qty`,
  `received_qty` and `prepared_qty` must be a single `UPDATE` (§3.3). Two
  statements inside one transaction fail on the first, which will look like a
  mystery until someone remembers this.
- `ordered_qty` / `received_qty` / `prepared_qty` are sums nothing enforces.
  Cancelling an order, or removing a product from a project, leaves them stale
  unless the same transaction adjusts them — the database will not notice.
  `orders.status = 'cancelled'` in particular has no defined effect on
  `project_parts.ordered_qty`; step 16 must decide one.

### 11.6 Fifth pass — folded in after building the migration

Found by writing a constraint smoke test
(`backend/database/tests/023-add-projects.test.sql`) that tries to insert the
wrong thing and asserts the database refuses. Three of these were accepted by
the schema as first written:

| # | Was | Now |
|---|---|---|
| B1 | `order_lines.part_id` could contradict its `project_part` — receiving would credit stock to the wrong part | composite FK `(project_part_id, project_id, part_id)` |
| B2 | An order for project A could carry a line whose `project_part` belongs to project B | `order_lines.project_id` + composite FKs to both `orders` and `project_parts` |
| B3 | A price cell could pair project A's company column with project B's part | `project_offer_prices.project_id` + composite FKs to both |
| B4 | §3.3 claimed the CHECKs left "no prose invariant for a service to remember" — untrue, they are not deferrable | §3.3 now states the single-`UPDATE` rule; §11.5 repeats it as a risk |
| B5 | `CHECK (required_qty > 0)` silently assumed no BOM line has quantity ≤ 0 | stated as a precondition in §3.3 and as a pre-step-1 risk in §11.5 |

The smoke test is the deliverable that makes these stay fixed: it asserts both
the refusals and the legal cases (the same product twice at different
revisions, a quoted price of zero, a fully received line), and exits non-zero
if a constraint is later dropped.

### 11.7 What survived review unchanged

The frozen BOM, the pinned revisions, the derived board, deriving reserved
quantity instead of storing reservations, one offer sheet per project, and
computing best price in the client.

### 11.8 Sixth pass — building `services/projectStock.ts`

Found by writing and then adversarially reviewing the service itself
(§4.2's two queries) against seeded data. None of these change what §4.2
promises the two queries compute; all three are implementation refinements
the plan text did not anticipate, kept here so the reasoning survives the
next person who touches this file.

| # | Problem | Now |
|---|---|---|
| C1 | The service shipped with no test committed to the repo — the acceptance check ("no stock" / "fully consumed" / "claimed by two started projects, one stopped") had been run once by hand and then discarded. Nothing would catch a future edit that silently broke `getReservedQuantities`. | `backend/src/services/projectStock.test.ts`, run via `npm run test:projectStock`: seeds the same three scenarios plus two more (`prepared_qty` fully picked; a project excluding its own claim) inside one transaction that is always rolled back, against the real dev database — the same convention `database/tests/023-add-projects.test.sql` uses for schema constraints, extended here to service-level logic. |
| C2 | `getAvailableQuantities` sums `quantity - quantity_consumed` per part with no per-row floor, unlike `frontend/src/utils/stock.ts`'s `availableOf()`, which clamps each row to `Math.max(0, ...)` before summing. The two are equivalent only as long as no single `stock_entries` row ever has `quantity_consumed > quantity` — true today because `routes/stockEntries.ts`'s FIFO deduction is careful never to over-consume a row, but the schema itself did not make it *impossible*. | Migration `024-guard-stock-consumption.sql` adds `CHECK (quantity_consumed <= quantity)` to `stock_entries`. The application-level guarantee becomes a database-level one; the frontend and backend can no longer silently disagree about a part's available stock. |
| C3 | `getPartStock` computed `available` and `reserved` as two independent queries (awaited together via `Promise.all`), each its own implicit transaction against the pool. A write landing between them (a stock receipt, another project starting) could make the two numbers reflect different instants, so the returned `free` value was never guaranteed to have been true at any single point in time — a narrower, purely technical inconsistency than the "claims can go stale over time" behaviour §4.2 already accepts by design. | `getPartStock` now runs both queries as CTEs inside **one** statement (`getAvailableQuantities` / `getReservedQuantities` stay separate exports, unchanged, for callers that only need one side). One statement is one snapshot regardless of isolation level, and it also cuts the round trip from two to one — strictly better than what §4.2 literally describes (two separate queries), while composing the exact same predicates. |

None of these needed a schema change beyond C2's single `CHECK`, and none
changed the two queries' predicates — only how completely their correctness
is guaranteed and how durably it is checked.

### 11.9 Seventh pass — building the board (step 6)

- **A stopped project was reaching the derived columns.** §4.1's membership
  rule reads only the four line counts, and `routes/projects.ts` implemented it
  literally. But a stopped project keeps its `project_parts` rows while its
  claims are released, so as soon as the filter included `stopped` its card
  reappeared under *Offers* or *Ordered* — contradicting §3.1, which puts a
  stopped project in *Projects* alone, greyed. The membership block in
  `GET /api/projects` now gates the four flags on `status IN ('started',
  'completed')`. A draft was already excluded in practice (it has no rows at
  all); the guard makes that explicit rather than incidental, and `completed`
  is kept in so §3.1's "*Prepared*" still holds. Fixed in the API, not the
  board, so the rule stays in the one readable place §4.1 asks for.
- **`views/projects/board/columns.ts`** is one file more than §6.2 lists. The
  five columns differ only in a title, a colour, which `in*` flag selects them
  and which count they badge, so they are data; `ProjectBoard.vue` is a
  `v-for` over them instead of five hand-written blocks, and
  `ProjectBoardColumn.vue` gets the descriptor's type from a module rather
  than from a `.vue` file — the same reason `views/products/detail/types.ts`
  exists.
- **Neither `AddPartsModal.vue` nor `PartsPicker.vue` was reused for
  `ProjectProductsEditor`,** per §6.3's instruction to check them first. The
  first is a modal in its own right and would have had to open on top of
  `ProjectModal`; the second is a parts list whose columns are
  quantity/unit/mount position and whose rows carry `SelectedPart`. Widening
  either would have meant a discriminator plus a slot per column — a helper no
  simpler than the two it replaced. The editor follows their *shape* (search,
  add, edit the staged rows in place) over products and their revisions.
- **The add row is `[product combobox] [revision] [Add]`.** The product side
  is a searchable dropdown over the whole catalog (name or SKU), not a fixed
  list occupying the modal; it reuses the popover shape `IconPicker` already
  established — a `relative` wrapper, an absolutely positioned panel, and
  close-on-outside-click, which is now `composables/useClickOutside.ts` shared
  by both rather than the same eight lines written twice.
- **`ProjectModal` is `size="xl"`,** so a handful of product lines fit before
  `BaseModal`'s body scrolls. The editor keeps a `min-h` that reserves room
  under the add row for the dropdown, which is absolutely positioned and was
  otherwise clipped by the scrolling body on a project with few lines. An
  earlier draft answered that with `scrollIntoView` when the panel opened,
  which moved the whole form under the user every time the box took focus;
  reserving the space instead means nothing scrolls at all.
- **Which revision a newly added product pins:** the revision `<select>` is
  pre-set to the product's `default_revision_id` when that is still free and
  otherwise to its **newest** free revision — the same "which revision stands
  for this product" rule `ProductsListView`'s `highlightedRevisionId` uses —
  and it lists only revisions not already in the project, so `UNIQUE
  (project_id, product_revision_id)` cannot be hit from the UI and adding the
  same product a second time at another revision (legal per §3.2) is one
  visible step. An earlier draft chose silently with no picker at all, which
  made that second line look impossible, and took the first revision the API
  happened to return — the *oldest* — which would have quietly frozen a
  project against an obsolete BOM whenever a product had no default set.
- **The board is one section card of five equal columns,** the shape the
  products list and the settings sections already use: a toolbar across the
  top and the content below. The columns are a five-column grid with
  `min-w-0` on each, so they share the width instead of forcing a horizontal
  scrollbar, and `divide-x` draws the line between them; below `xl` they
  stack and the dividers turn with them. Card actions moved into a
  three-dot menu (`board/ProjectCardMenu.vue`, reusing `useClickOutside`)
  because labelled buttons do not fit a fifth of the board's width.
- **The card's action menu is teleported and fixed, not anchored.** Inside
  the column's scrolling card list an absolute popover on the last card opens
  below the clipped edge; the menu now positions itself from the trigger's
  rect and closes on any scroll or resize, since those coordinates go stale
  the moment anything moves. It is also mounted only for projects that have
  actions (`hasCardActions`), so a stopped or completed card registers no
  outside-click listener for a menu that would render nothing.
- **Each project gets its own accent colour,** drawn down the card's left
  edge, so one project is recognisable wherever it appears across the five
  columns. Derived from the id rather than randomised or stored — a colour
  that changes between renders identifies nothing — and `id % palette.length`
  rather than a hash, since ids are sequential and that guarantees ten
  projects created in a row are ten different colours where a hash would let
  neighbours collide. Colour now means exactly one thing on a card: the
  per-column badge tints went neutral and each column's colour lives in its
  header alone.
- **The palette itself is `utils/cardAccent.ts`, shared with the Documents
  panel.** `documentCardStyle.ts` already cycled a fixed list of hues by card
  index for its icon tiles — the same decision, written twice, in two
  overlapping palettes that would have drifted apart on the first restyle.
  One list now serves both, in the two renderings they need: `tile` (a pale
  background plus a saturated glyph) and `stroke` (a raw colour for a border).
  The Documents panel's existing order is preserved exactly, since its live
  cards are seeded by position and reordering would repaint them; the board's
  hues were the ones that moved, being unshipped. The list grew from eight to
  ten, so a panel with more than eight cards now repeats later than it used
  to.
- **The board payload now carries each project's products** — name, SKU,
  revision label and quantity — as a sub-select rather than a join, since
  joining `project_products` beside `project_parts` would multiply the rows
  the §4.1 counts are computed from. The card lists three and expands on
  demand. `productCount` is gone: it was the same fact as the list's length.
- **`doneLines` was added to §4.1's counts** for the card's progress bar:
  lines with nothing outstanding at all. It is deliberately not `lineCount`
  minus the other three — those overlap, since one line can be part-ordered
  and part-pickable at the same time. It agrees with `inPrepared` by
  construction (`doneLines = lineCount` is the same test), so the membership
  rule is unchanged.
- **The picker distinguishes its four empty states** — loading, load failed
  (with the API error and a retry), an empty catalog, and no match for the
  search — because a failed `GET /api/products` otherwise renders as "no
  products" and reads like an empty database. It re-reads the catalog on
  every modal open rather than trusting whatever `productsStore` last
  cached, and hides only `archived` products (rather than keeping only
  `active` ones) so a product the API sends without a status is still
  offered.
- **`ConfirmModal` refuses a click it cannot have been read for.** A delete
  was reported going through with no dialog on screen while the success toast
  still fired — which means `confirm()` ran, so the dialog had mounted. The
  cause was never reproduced, so the fix is structural rather than a patch to
  a path nobody found: the dialog ignores confirm clicks for 300 ms after it
  becomes visible (a click already travelling up the DOM, or the second click
  of a double-click landing where the button just appeared, cannot reach it),
  and it moves focus to Cancel so a stray Enter destroys nothing. `variant:
  'primary'` confirms a save rather than a deletion, so that one focuses the
  confirm button instead. This is shared chrome — nine call sites gain the
  same guard.
- **§4.1's *Prepared* rule needed a floor, and this is a change to the plan.**
  As written, a line is outstanding on three comparisons between sourcing
  columns — and zero equals zero, so a line requiring 5 pieces with nothing in
  stock, nothing ordered and nothing prepared is outstanding on none of them.
  Every `CHECK` on `project_parts` accepts that row, and `PATCH
  /:id/parts/:id` reaches it by setting `missing_qty` to 0 while `ordered_qty`
  is 0, so the board would have called such a project *Prepared* and drawn a
  100% bar over work that had not started. `doneLines` therefore also requires
  `prepared_qty >= required_qty`, and `inPrepared` is now read off `doneLines`
  rather than re-testing the three counts — the same question asked twice is
  how a board and its progress bar come to disagree about what finished means.
  Confirmed against a real database before changing anything.
- **`POST` and `PATCH /api/projects` reject an archived product**
  (`PRODUCT_ARCHIVED`). The picker already hid them, but decision 1 rests on
  the pinned BOM being trustworthy, and a rule that lives only in a modal is
  not a rule. A product archived *after* a draft pinned it keeps its line; this
  guards what a write sends, not what history holds.
- **The name search filters in the browser.** `?q=` stays in the URL so a
  filtered board is still a shareable link, but a board is tens of rows, so
  matching them client-side is instant and deletes both the per-keystroke
  request and the reason the store needed a stale-response guard for it. The
  endpoint keeps its `q` parameter for a caller that one day has more rows
  than a person can scroll.
- **`database/tests/project-board-query.test.sql`** covers §4.1's counting
  rules, which nothing in the UI can reach until Start exists: before step 8
  every project has zero `project_parts` rows, so every count is zero and four
  of the five columns are permanently empty. An inverted comparison would
  therefore have stayed invisible for a whole story and then surfaced as a bug
  in the story that merely started populating the table. Six fixture projects
  cover a draft, a started project with one line in each state (including one
  line that is to-buy, on-order and pickable at once), an all-done project, a
  stopped one and a completed one. The test was mutation-checked rather than
  merely run: inverting a `doneLines` comparison, dropping the stopped-project
  guard, ordering the products by id instead of `position`, counting `*`
  instead of `pp.id`, weakening `onOrderLines` to `ordered_qty > 0`, removing
  the `prepared_qty >= required_qty` floor, and reverting `inPrepared` to the
  three-counts rule each make it fail. Two mutations survived the first draft
  and each added a fixture: dropping `received_qty` from the `toPickLines` sum
  (fixed by a line pickable only because goods arrived) and the `inPrepared`
  revert (fixed by a started project whose every column is zero).
- **Start and Stop ship disabled** with a "coming soon" tooltip: their
  endpoints arrive in step 8. `useConfirmDelete` is therefore wired for Delete
  only — the Stop confirmation would be unreachable code today. It uses the
  same composable, unchanged, when step 8 enables the button (§11.4).

### 11.10 Eighth pass — building `services/projectBom.ts` and `GET /:id/parts` (step 7)

Found by building the computation and its test against seeded data. Nothing
here changes what §3.4 computes; the first two are contract details §5.4 left
open, the rest is how the two forms of the BOM were kept from drifting.

| # | Problem | Now |
|---|---|---|
| D1 | §5.4 types the row's `id` as `number`, but a **draft**'s rows are computed and have no `project_parts.id` to put there. Inventing one (the part id, or 0) would put two different id spaces in one field, and the first `PATCH /:id/parts/:projectPartId` built from it would address the wrong row. | `id: number \| null`, null exactly when `draft: true`. It is not a second payload shape: the keys are identical, and a null `id` is the same kind of statement as the progress buckets being zero. Rows are keyed on `part.id`, which both forms carry and `UNIQUE (project_id, part_id)` keeps unique per project. |
| D2 | Two different expressions for the same flag. §4.2 says the table flags `available < reserved + (from_stock_qty - prepared_qty)`; §5.4 says "available < reserved + this project's own outstanding claim". They differ by `received_qty`, and §4.2's own definition of `reserved` — `from_stock_qty + received_qty - prepared_qty` over *other* started projects — settles which is meant: goods received against this project are sitting in stock with its name on them, exactly as they are for everybody else's. | `stockShortfall` is `availableQty < reservedQty + toPickQty`, so the row is compared with other projects on identical terms. §4.2's shorter expression reads as shorthand from before `received_qty` counted toward the pick. |
| D3 | "One payload shape either way" is a promise two independently written branches would eventually break — the draft path and the frozen path each build the same rows from a different source. | Both readers (`computeProjectBom`, `loadFrozenProjectBom`) answer with one intermediate shape, and a single mapper (`toProjectPartRows`) produces the payload from either. The collapse of usages to distinct products and the three derived quantities are therefore written once, not once per branch, and the test asserts the two forms agree key for key. |
| D4 | §5.4 says `qtyForProduct` "is computed in the query". Doing that would mean writing the level-2 aggregation twice — once in the draft flatten, once in the frozen read — which is the same decision in two places and the way the two would come to disagree. | Level 2 is computed once in TypeScript, in the shared mapper. Exactly, with no rounding: every quantity is a whole number (§11.11), and JS holds integers to 2^53 without loss. |
| D5 | §3.4's `usage` CTE is written for the insert-from-select the freeze will run. Read-only, it needs no CTE at all. | `computeProjectBom` is the same joins as a plain `SELECT`, with the display columns (part, category, SKU, revision label) joined on, aggregated per part in memory. Two round trips: the flatten, then §4.2's stock read for every part id at once. |
| D6 | The frozen read is three statements (parts, usages, stock) and so is not the single snapshot §11.8 (C3) went to some trouble to give `getPartStock`. | Accepted, deliberately. C3's fix was free — one statement instead of two composing the same predicates — and it guarded a number the *freeze* writes. This endpoint only displays, over quantities §4.2 already says go stale, and buying a snapshot here would mean a `REPEATABLE READ` transaction around a read-only request. Worth knowing, not worth the machinery. |
| D7 | A BOM line with `quantity <= 0` is still representable (§11.5), and a draft would show it. | `required_qty` is returned exactly as computed — the CHECK is what refuses the project at Start, and rounding it up here would hide the reason — while the seeded `from_stock_qty` / `missing_qty` are clamped at zero so the sourcing columns never read as a negative claim. |

| D8 | The shortfall flag fired on a **stopped** project, over a claim stopping had already released — and on a **completed** one, whose rows can only be flagged by somebody else's oversubscription. Both read as a warning about stock nobody is competing for. | `toProjectPartRows` takes the project's status and flags only while the claim is one others actually count: `draft` (prospective — "the stock this quote counts on is already spoken for" is what a salesman needs before starting) and `started`. The condition is deliberately the same status filter §4.2's `reserved` uses, so a row is warned about exactly when it is competing. Nothing else in the payload changes; greying a stopped project's sourcing columns is the table's business, from the status it already has. |

| D9 | A frozen row's `qtyForProduct` multiplies the **frozen** `qty_per_unit` by the **live** `project_products.quantity`, so the snapshot is not self-contained. Nothing can change that today — PATCH and DELETE both refuse a non-draft project — but the guarantee is enforced in `routes/projects.ts` while the dependency lives in `services/projectBom.ts`. | Left as computed: §3.4's three levels define level 2 as exactly that product, and level 2 is deliberately not stored. Written down here as an invariant instead, because the failure is silent and misleading — change a started project's quantity from 2 to 3 and the row reports `requiredQty` 26 with `products` summing to 34, which §5.4 says means the *freeze* got it wrong. **Any story that lets a started project's product quantities move must freeze the quantity alongside the usage**, or drop the per-product breakdown for frozen rows. |
| D10 | The draft-versus-frozen switch, and the status that decides the shortfall flag, sat in the route — the one place with no test in this repo. Inverted, a started project answers with recomputed rows carrying none of its purchasing progress: plausible-looking output, silently wrong, and every check still green. | `loadProjectPartsPayload(db, projectId, status)` in the service returns the whole `{ draft, rows }` payload, and the route is a status lookup plus that call. The decision now sits in the file whose stated job is knowing both forms, and the test covers it directly. |

**A draft is recomputed on every fetch, and that is affordable.** Measured
against a deliberately oversized project — 4 products x 25 sub-products,
6 000 usage rows, 800 distinct parts over 3 000 stock entries — the flatten
runs in ~9 ms and the stock read in ~10 ms, with the whole call under ~70 ms
warm; a real project is a fraction of that. Nothing here is cached
server-side, deliberately: `availableQty` / `reservedQty` are live stock,
which is the number the page exists to answer and which any receipt or
project start elsewhere invalidates at once, and a draft's BOM itself moves
whenever its product set or a pinned *draft* sub-product revision is edited.
The frontend caches per selected project instead (§6.3), which is where the
repeated-selection cost actually lives. If anything ever needs attention it
is the payload — 800 rows serialise to ~650 KB — and the answer to that is
trimming what a row carries, not caching a stale one.

`backend/src/services/projectBom.test.ts` (`npm run test:projectBom`) is the
acceptance check, committed for the reason C1 gives. Its fixture is §3.4's
worked example verbatim — the same two products, three sub-products and shared
screw — so the 26 the aggregation produces is checked against the number the
plan works out by hand, over both forms of the BOM, plus the collapse to
distinct products, the stock seeding, the shortfall flag, and the round-trip
counts that keep either reader from going per part. It also covers §3.4's
same-product-at-two-revisions case, because that is what forces the Products
cell to be keyed per `project_products` line rather than per product — key it
per product and the two chips silently merge, taking one revision's quantity
with them. It also asserts that the quantities arrive as JS
numbers rather than NUMERIC strings, which is the observable difference §11.11
bought and the thing a column quietly reverting to `NUMERIC` would break. And it covers stopping end to end: a started
project's outstanding claim is counted against every other project, the stop
is a status flip that writes no stock row, and the next read of any other
project sees the freed quantity while `available` never moved — the whole
reason §4.2 has no reservations table to release.

### 11.12 Tenth pass — building Start and Stop (step 8)

Found by building the freeze against the computation §11.10 had already
settled. Nothing here changes what is stored; it is where the two endpoints
differ from what §5.3 literally describes, and why.

| # | Problem | Now |
|---|---|---|
| E1 | §3.4 writes the freeze as one insert-from-select, and §5.3 says to re-run `computeProjectBom` inside the transaction. Doing both would be the §3.4 aggregation written twice — the exact drift §11.10 (D3, D4) spent the previous pass eliminating between the two *readers*. | `freezeProjectBom` computes with `computeProjectBom` and writes what it returns: two bulk `unnest` inserts, no per-part loop and no second copy of the join. §3.4's SQL stays in the plan as the statement of what the aggregation *is*. The usage rows need the ids the first insert assigns, so the two statements could not have been one anyway. `RETURNING` promises no ordering, so they are matched back by part id, not by position. |
| E2 | Two error codes could cover the refusal: `PROJECT_HAS_NO_PRODUCTS` for an empty product set, `PROJECT_HAS_NO_PARTS` for revisions that yield nothing. | One test covers both, as §5.3 says: a project with no products freezes no parts, so the row count `freezeProjectBom` returns is the whole check and the code is always `PROJECT_HAS_NO_PARTS`. 409, not the 422 the create/update path uses for the same-sounding condition — there is no request body here to be invalid, only a project that cannot be started as it stands. |
| E3 | "Starting twice is refused" needs a code for every non-draft status, and there is no `PROJECT_NOT_DRAFT`. | `PROJECT_ALREADY_STARTED` for all of them, because it is true of all of them: `stopped` and `completed` are terminal (§3.1), so every status but `draft` means the project was started once already. A second code would say the same thing in different words. |
| E4 | `freezeProjectBom` typed against `Queryable`, as every other function in the service is, would accept `pool` — and then the advisory lock is taken on one connection and released immediately, the two inserts run on others, and the freeze is silently unserialised. Exactly the failure §5.3.5 exists to prevent, reintroduced by a plausible call. | It takes a `PoolClient`. The transaction is not a convention the caller is asked to remember; it is the parameter type. |
| E5 | Two locks in one transaction: the project row (`FOR UPDATE`, so a concurrent PATCH or a second Start cannot race the status check) and the global advisory lock. Taken in the wrong order by some future caller, that is a deadlock. | Row first, advisory second, and nothing else in the codebase takes the advisory lock at all. A second Start of the *same* project therefore waits on its row and finds `started` when it gets there, rather than queueing behind every other project's freeze. |
| E6 | Start is offered from a menu, is irreversible, and leaves a project that can no longer be edited or deleted — but story 5 only spoke of confirmations for the two destructive actions. | Confirmed like them. `DeleteConfirmModal` was widened with `confirmTextKey` and `variant` rather than copied, which is §11.4's stance on `useConfirmDelete` applied to the modal that pairs with it: the name still says delete, the behaviour is "confirm an action on a named target", and renaming both would touch working call sites for nothing. |

The freeze's own acceptance check is that it changes no number: `projectBom.test.ts`
freezes the draft it has already asserted in full and compares the rows read
back from `project_parts` with the ones `computeProjectBom` produced, field for
field, `id` excepted. That is the property Start exists to have — the salesman
commits to the figures he was looking at — and it is one assertion rather than a
restatement of §3.4's arithmetic in a second place.

### 11.11 Ninth pass — quantities are whole parts (migration 025)

Raised by reading the code back: the service was rounding its arithmetic to
three decimals, and the fixture that defended that rounding had to invent a
fractional BOM line to do it. The question that followed — why is a quantity a
float at all — has one answer, and it is not the one the schema gave.

**The application has always insisted on whole parts; only the columns
disagreed.** A BOM line was rounded on write (`schemas/parts.schema.ts`), the
three inputs that edit one truncate (`PartsPicker`, `AddPartsModal`,
`PartsEditorPanel`, all via `utils/numberInput.ts`), every read of it cast
`::integer`, and stock entries and removals are `z.number().int()`. Against
that, `NUMERIC(12,3)` bought nothing but arithmetic that needed rounding and
values that reached node as strings. Migration 025 makes the columns say what
the code already meant:

| | |
|---|---|
| `project_parts` — all six quantity columns | → `INTEGER` |
| `project_part_usages.qty_per_unit`, `order_lines.quantity` / `received_qty` | → `INTEGER` |
| `sub_product_revision_parts.quantity` | → `INTEGER` — `required_qty` is computed from it, so a fraction there would defeat the rest |
| `stock_entries.quantity` / `quantity_consumed` | keeps `NUMERIC(10,3)`, gains a whole-number CHECK — available stock seeds `from_stock_qty`, but changing that type would change how stock reaches the browser, which is the stock module's call, not this one's |

Three things that came out of doing it:

- **An `INTEGER` column rounds 1.5; it does not refuse it.** So the type is
  not the guarantee — the boundary is. `parts.schema.ts` now validates with
  `z.number().int().positive()` instead of `Math.round`, turning a fractional
  BOM line into a clean 422 rather than a silently doubled quantity. Every
  future endpoint taking a quantity owes the same (story 8, story 15).
- **The projects tables had no writer yet**, so the conversion moved no data.
  The two feeder columns do hold production data, which is why the migration
  header carries the two queries to run against production first: on
  fractional data it fails, and that is the right outcome.
- **`services/projectBom.ts` lost its rounding helper and its
  `Number(...)` conversions**, and the five `::integer` casts in the products
  module went with them — all of them were compensating for a column type that
  no longer exists.

**The frontend carried the same hedge, and lost it too.** `RevisionPart
.quantity` was `number | string` — the shape a NUMERIC column arrives in —
along with `BomExportRow.quantity` and `AlternativesPanel`'s quantity prop, and
three `Number(...)` coercions existed only to undo it. All are plain `number`
now. `pricePerPiece` deliberately keeps its union: money is still NUMERIC and
does reach the client as a string. The projects module's own types were already
`number`, because `project_products.quantity` was `INTEGER` from the start —
which is the shape the Parts table's rows (story 9) inherit.

**Three things the review of this pass caught, all of them in how the change
lands rather than in what it changes.**

- **`ALTER COLUMN ... TYPE INTEGER USING x::integer` rounds; it does not
  refuse.** Verified: 1.5 becomes 2, 2.4 becomes 2. On a production BOM line
  that is a silent rewrite with no record of itself, and the migration's first
  draft claimed the opposite in its own header. Each conversion is now fronted
  by a temporary `CHECK (x = round(x))` that is validated against every
  existing row, fails by name if one is fractional, and is dropped once the
  type carries the rule. On a database holding a 1.5 the migration now aborts
  and the 1.5 is still 1.5 afterwards.
- **Schema first, then code — and `deploy-ssh.sh` had it backwards.** It ran
  `compose up -d` and migrated afterwards. Narrowing a column is only safe in
  that direction if the new code can read the old schema, and it cannot:
  `NUMERIC` reaches node as a string, `collapseToProducts` concatenates
  instead of adding ("2.0002.000"), and `stockShortfall` silently reads false.
  Running the current service against a pre-025 schema fails nine of its
  checks. The script now brings the database up, migrates, and only then
  recreates backend and frontend — stopping the deploy, with the old
  containers still serving, if a migration fails. DEPLOY.md says the same for
  the manual path.
- **The BOM line schema enforces whole, not positive.** Tightening it to
  `.positive()` looked like an improvement and was a regression: the parts
  editor re-sends a revision's entire part set on every change, so one legacy
  `quantity = 0` row (§11.5 says they may exist) would have made that whole
  revision unsavable. `z.number().int()` it is; `required_qty > 0` at the
  freeze is where a non-positive quantity is refused, and the three inputs
  that can create one all require >= 1 — `PartsPicker` included, which until
  now had `min="0"` and validated only that the field was filled in.

`database/tests/025-integer-project-quantities.test.sql` asserts the column
types (not a refusal, per the rounding note above) and that the stock CHECK
refuses 1.5 and accepts 10; it seeds its own category, company and part rather
than borrowing whatever the database holds, so it cannot quietly skip.
