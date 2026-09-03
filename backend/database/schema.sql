CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(60),
  password_hash TEXT NOT NULL,
  admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS part_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  description TEXT,
  image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS part_category_parameters (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES part_categories(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'number', 'boolean')),
  unit VARCHAR(40),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(category_id, name)
);

CREATE TABLE IF NOT EXISTS parts (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES part_categories(id),
  name VARCHAR(180) NOT NULL,
  code VARCHAR(120) NOT NULL UNIQUE,
  price_per_piece NUMERIC(12, 2) NOT NULL DEFAULT 0,
  location VARCHAR(180),
  description TEXT,
  image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_parameters (
  id SERIAL PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  parameter_id INTEGER NOT NULL REFERENCES part_category_parameters(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(part_id, parameter_id)
);

CREATE INDEX IF NOT EXISTS idx_part_category_parameters_category_id ON part_category_parameters(category_id);
CREATE INDEX IF NOT EXISTS idx_parts_category_id ON parts(category_id);
CREATE INDEX IF NOT EXISTS idx_stock_parameters_part_id ON stock_parameters(part_id);

-- Idempotent migrations (safe to re-run on existing databases) ---------------

-- Dropdown options for category parameters
ALTER TABLE part_category_parameters
  ADD COLUMN IF NOT EXISTS options TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- Allow 'dropdown' as a parameter type
ALTER TABLE part_category_parameters
  DROP CONSTRAINT IF EXISTS part_category_parameters_type_check;
ALTER TABLE part_category_parameters
  ADD CONSTRAINT part_category_parameters_type_check
  CHECK (type IN ('text', 'number', 'boolean', 'dropdown'));

-- Render this parameter as its own dedicated column in the Parts table
-- (after the Name column) instead of inside the shared "Other Parameters" cell.
ALTER TABLE part_category_parameters
  ADD COLUMN IF NOT EXISTS show_as_column BOOLEAN NOT NULL DEFAULT FALSE;

-- Explicit display order for a category's parameters. Drives both the order
-- shown on the Part Categories page (drag-and-drop reorder) and the order of
-- parameter columns in the Parts table. Lower values sort first.
ALTER TABLE part_category_parameters
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Part code (required + unique). Added nullable, backfilled, then constrained
-- so the migration also works on databases that already contain parts.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS code VARCHAR(120);
UPDATE parts SET code = 'PART-' || id WHERE code IS NULL;
ALTER TABLE parts ALTER COLUMN code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parts_code_key'
  ) THEN
    ALTER TABLE parts ADD CONSTRAINT parts_code_key UNIQUE (code);
  END IF;
END $$;

-- Part image (uploaded file URL, stored in uploads/parts)
ALTER TABLE parts ADD COLUMN IF NOT EXISTS image TEXT;

-- How a category names its parts: 'custom' (the user types the name) or
-- 'parameters' (generated from the category name + its show_as_column
-- parameter values, prefixed by any text the user typed).
ALTER TABLE part_categories
  ADD COLUMN IF NOT EXISTS part_name_mode VARCHAR(20) NOT NULL DEFAULT 'custom';
ALTER TABLE part_categories
  DROP CONSTRAINT IF EXISTS part_categories_part_name_mode_check;
ALTER TABLE part_categories
  ADD CONSTRAINT part_categories_part_name_mode_check
  CHECK (part_name_mode IN ('custom', 'parameters'));

-- The raw text the user typed for a part's name. `name` holds the resolved
-- display string; this keeps the prefix so a generated name can be rebuilt
-- when its category is renamed or its column parameters change.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS name_prefix VARCHAR(180);
UPDATE parts SET name_prefix = name WHERE name_prefix IS NULL;

-- Alternate codes the same part is ordered under at other companies (see
-- migration 020). `code` stays the one required, unique identifier; this is
-- an optional, unordered list with no uniqueness constraint.
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS secondary_code TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- ===========================================================================
-- Product Management & Revisioning module
-- ---------------------------------------------------------------------------
-- Uses SERIAL integer PKs to stay consistent with the rest of the schema
-- (users, part_categories, parts). The existing `parts` table is reused as
-- the leaf node. Per-usage quantity/unit live on sub_product_revision_parts.
--
-- Deliberately contains NO functions, triggers, enums, or DO/$$ blocks so the
-- whole file runs statement-by-statement in any SQL client. Matching the rest
-- of this schema, `status` uses a CHECK constraint (not a Postgres ENUM) and
-- `updated_at` is set explicitly in the API UPDATE queries (see parts.ts),
-- not via a trigger. All statements are idempotent and safe to re-run.
-- ===========================================================================

-- Core entities ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  -- Unique only among active products (see migration 004) — the plain
  -- UNIQUE this used to carry blocked reusing an archived product's SKU.
  sku         VARCHAR(100) NOT NULL,
  -- Required (see migration 003).
  type        VARCHAR(100) NOT NULL,
  -- Optional (see migration 015).
  image       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_products (
  id          SERIAL PRIMARY KEY,
  -- Every sub-product belongs to one main product (see migration 001).
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  -- Optional (see migration 002): unlike products.sku, a sub-product may be
  -- created without one. UNIQUE still allows any number of NULLs in Postgres.
  sku         VARCHAR(100) UNIQUE,
  -- Required (see migration 003).
  type        VARCHAR(100) NOT NULL,
  -- Optional (see migration 015): unlike products.image, a sub-product may
  -- have none.
  image       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revision tables ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_revisions (
  id              SERIAL PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  revision_number INT  NOT NULL,
  label           VARCHAR(100) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'deprecated')),
  change_notes    TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, revision_number)
);

CREATE TABLE IF NOT EXISTS sub_product_revisions (
  id              SERIAL PRIMARY KEY,
  sub_product_id  INTEGER NOT NULL REFERENCES sub_products(id) ON DELETE CASCADE,
  revision_number INT  NOT NULL,
  label           VARCHAR(100) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'deprecated')),
  change_notes    TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sub_product_id, revision_number)
);

-- Junction tables ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_revision_sub_products (
  id                      SERIAL PRIMARY KEY,
  product_revision_id     INTEGER NOT NULL REFERENCES product_revisions(id) ON DELETE CASCADE,
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  position                INT NOT NULL DEFAULT 0,
  UNIQUE(product_revision_id, sub_product_revision_id)
);

CREATE TABLE IF NOT EXISTS sub_product_revision_parts (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  part_id                 INTEGER NOT NULL REFERENCES parts(id),
  quantity                NUMERIC(10,3) NOT NULL,
  unit                    VARCHAR(50),
  notes                   TEXT,
  UNIQUE(sub_product_revision_id, part_id)
);

-- Note: the "next revision number" is computed inline in the API INSERT
-- queries with a COALESCE(MAX(revision_number), 0) + 1 subquery, so no SQL
-- helper functions are needed here.

-- Indexes ------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_product_revisions_product_id ON product_revisions(product_id);
CREATE INDEX IF NOT EXISTS idx_sub_product_revisions_sub_product_id ON sub_product_revisions(sub_product_id);
CREATE INDEX IF NOT EXISTS idx_sub_products_product_id ON sub_products(product_id);
CREATE INDEX IF NOT EXISTS idx_prsp_product_revision_id ON product_revision_sub_products(product_revision_id);
CREATE INDEX IF NOT EXISTS idx_prsp_sub_product_revision_id ON product_revision_sub_products(sub_product_revision_id);
CREATE INDEX IF NOT EXISTS idx_sprp_sub_product_revision_id ON sub_product_revision_parts(sub_product_revision_id);
CREATE INDEX IF NOT EXISTS idx_sprp_part_id ON sub_product_revision_parts(part_id);

-- Where the part sits on the sub-product, e.g. "left side", "R12" (see
-- migration 018). Per BOM line rather than per part: `parts.location` is the
-- warehouse spot, this is the spot on the assembly, and the same part sits
-- differently in different products.
ALTER TABLE sub_product_revision_parts
  ADD COLUMN IF NOT EXISTS mount_position VARCHAR(120);

-- Optional pointer to a product's default (canonical) revision. Added here,
-- after product_revisions exists, so the FK target is available. On revision
-- deletion the pointer is cleared rather than blocking the delete.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS default_revision_id INTEGER
    REFERENCES product_revisions(id) ON DELETE SET NULL;

-- Product archive status ('active' by default, can be set to 'archived').
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_status_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_status_check
        CHECK (status IN ('active', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- SKU uniqueness is scoped to active products (see migration 004). Drop the
-- old table-wide UNIQUE constraint (if a pre-migration-004 install still has
-- it) and replace it with a partial unique index that ignores archived rows,
-- so a new or reactivated product can reuse an archived product's SKU.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_active_unique
  ON products (sku) WHERE status = 'active';

-- Documents live further down, in the "Required Document Types" section: they
-- hang off a product / sub-product REVISION and point at a `stored_files` row
-- rather than owning their bytes (see migration 013). The old product-level
-- `product_documents` and the flat `sub_product_revision_documents` that used
-- to be defined here were dropped by that migration and are deliberately not
-- recreated — defining them here would have every fresh database create two
-- tables no code reads.

-- ===========================================================================
-- Product / Sub-product types (Settings page)
-- ---------------------------------------------------------------------------
-- `products.type` / `sub_products.type` used to be free text. They now must
-- reference one of these managed lists, enforced with a FK on the `name`
-- column (kept UNIQUE) rather than swapping to an id column, so existing
-- data and application code that reads/writes `type` as a string keep
-- working unchanged. ON UPDATE CASCADE means renaming a type from the
-- Settings page automatically updates every product/sub-product using it;
-- deleting a type that is still in use is rejected by the FK (no ON DELETE
-- clause defaults to RESTRICT) and surfaced as a friendly error by the API.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS product_types (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_product_types (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill: turn every distinct value already used by an existing
-- product/sub-product into a real type row, so the FK constraints below
-- don't reject pre-existing data.
INSERT INTO product_types (name)
  SELECT DISTINCT type FROM products WHERE type IS NOT NULL AND type <> ''
  ON CONFLICT (name) DO NOTHING;

INSERT INTO sub_product_types (name)
  SELECT DISTINCT type FROM sub_products WHERE type IS NOT NULL AND type <> ''
  ON CONFLICT (name) DO NOTHING;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_type_fkey FOREIGN KEY (type)
    REFERENCES product_types (name) ON UPDATE CASCADE;

ALTER TABLE sub_products DROP CONSTRAINT IF EXISTS sub_products_type_fkey;
ALTER TABLE sub_products
  ADD CONSTRAINT sub_products_type_fkey FOREIGN KEY (type)
    REFERENCES sub_product_types (name) ON UPDATE CASCADE;

-- ===========================================================================
-- Required Document Types (see migrations 013 and 016)
-- ---------------------------------------------------------------------------
-- Document requirements live in the template tables below. Each physical file
-- is recorded once in `stored_files`; thin per-revision rows point at a stored
-- file + a document type, so a file can be shared across revisions by pointer
-- without being copied on disk. Product docs are scoped per product REVISION
-- (not per product). The tables these replaced were dropped by migration 013
-- (both were empty), so nothing legacy is defined here. All blocks are
-- idempotent.
--
-- A template is scoped EITHER to a type or to a single entity (migration 016):
--
--   product_type_id set -> applies to every product of that type
--   product_id      set -> applies to that one product only
--
-- Exactly one of the two, per the CHECK. The type FK is nullable rather than
-- being filled in as well: templates are reached through
-- `product_types.name = products.type`, so a product-scoped row carrying a type
-- id would vanish from its own panel if the product's `type` were changed.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS product_document_types (
  id                 SERIAL PRIMARY KEY,
  product_type_id    INTEGER REFERENCES product_types(id) ON DELETE CASCADE,
  product_id         INTEGER REFERENCES products(id) ON DELETE CASCADE,
  name               VARCHAR(120) NOT NULL,
  icon               VARCHAR(60)  NOT NULL,
  allowed_extensions TEXT[] NOT NULL DEFAULT '{}',
  required           BOOLEAN NOT NULL DEFAULT TRUE,
  -- Holds versions rather than loose files (see "Document revisions" below).
  revision_mode      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_document_types_scope_chk
    CHECK ((product_type_id IS NULL) <> (product_id IS NULL)),
  -- A type-scoped template is shared by every product of its type, so it has
  -- no single version history to own.
  CONSTRAINT product_document_types_revision_scope_chk
    CHECK (NOT revision_mode OR product_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sub_product_document_types (
  id                  SERIAL PRIMARY KEY,
  sub_product_type_id INTEGER REFERENCES sub_product_types(id) ON DELETE CASCADE,
  sub_product_id      INTEGER REFERENCES sub_products(id) ON DELETE CASCADE,
  name                VARCHAR(120) NOT NULL,
  icon                VARCHAR(60)  NOT NULL,
  allowed_extensions  TEXT[] NOT NULL DEFAULT '{}',
  required            BOOLEAN NOT NULL DEFAULT TRUE,
  revision_mode       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sub_product_document_types_scope_chk
    CHECK ((sub_product_type_id IS NULL) <> (sub_product_id IS NULL)),
  CONSTRAINT sub_product_document_types_revision_scope_chk
    CHECK (NOT revision_mode OR sub_product_id IS NOT NULL)
);

-- One partial unique index per scope rather than a table-level UNIQUE: the
-- unused FK is NULL, and every NULL is distinct in Postgres, so a plain
-- UNIQUE(product_type_id, name) would not constrain product-scoped rows at all.
--
-- Keyed on LOWER(name): these are card labels, so "Datasheet" beside
-- "datasheet" is a duplicate to anyone reading the panel, and the API's own
-- cross-scope check compares case-insensitively too.
--
-- Collisions BETWEEN the scopes are rejected by the API (routes/documentTypes.ts)
-- — the type is reached through a join, so no constraint can express it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_document_types_type_name
  ON product_document_types(product_type_id, LOWER(name))
  WHERE product_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_document_types_product_name
  ON product_document_types(product_id, LOWER(name))
  WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_product_document_types_type_name
  ON sub_product_document_types(sub_product_type_id, LOWER(name))
  WHERE sub_product_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_product_document_types_sp_name
  ON sub_product_document_types(sub_product_id, LOWER(name))
  WHERE sub_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_document_types_type_id
  ON product_document_types(product_type_id);
CREATE INDEX IF NOT EXISTS idx_product_document_types_product_id
  ON product_document_types(product_id);
CREATE INDEX IF NOT EXISTS idx_sub_product_document_types_type_id
  ON sub_product_document_types(sub_product_type_id);
CREATE INDEX IF NOT EXISTS idx_sub_product_document_types_sub_product_id
  ON sub_product_document_types(sub_product_id);

CREATE TABLE IF NOT EXISTS stored_files (
  id          SERIAL PRIMARY KEY,
  storage_key TEXT     NOT NULL,   -- relative path within uploads/documents/
  size_bytes  BIGINT   NOT NULL,
  mime_type   VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- UNIQUE: one stored_files row per physical file is the invariant the sharing
-- model (carry-forward / copy-on-write) rests on. See migration 013.
DROP INDEX IF EXISTS idx_stored_files_storage_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_stored_files_storage_key
  ON stored_files(storage_key);

CREATE TABLE IF NOT EXISTS product_revision_documents (
  id                  SERIAL PRIMARY KEY,
  product_revision_id INTEGER NOT NULL REFERENCES product_revisions(id) ON DELETE CASCADE,
  document_type_id    INTEGER REFERENCES product_document_types(id) ON DELETE SET NULL,
  stored_file_id      INTEGER NOT NULL REFERENCES stored_files(id),
  original_name       VARCHAR(255) NOT NULL,
  uploaded_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prod_rev_docs_rev_id
  ON product_revision_documents(product_revision_id);
CREATE INDEX IF NOT EXISTS idx_prod_rev_docs_type_id
  ON product_revision_documents(document_type_id);
CREATE INDEX IF NOT EXISTS idx_prod_rev_docs_stored_file_id
  ON product_revision_documents(stored_file_id);


CREATE TABLE IF NOT EXISTS sub_product_revision_documents (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  document_type_id        INTEGER REFERENCES sub_product_document_types(id) ON DELETE SET NULL,
  stored_file_id          INTEGER NOT NULL REFERENCES stored_files(id),
  original_name           VARCHAR(255) NOT NULL,
  uploaded_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sp_rev_docs_sp_rev_id
  ON sub_product_revision_documents(sub_product_revision_id);
CREATE INDEX IF NOT EXISTS idx_sp_rev_docs_type_id
  ON sub_product_revision_documents(document_type_id);
CREATE INDEX IF NOT EXISTS idx_sp_rev_docs_stored_file_id
  ON sub_product_revision_documents(stored_file_id);

-- Generic, append-only audit log (see migration 012). No FK on entity_id so a
-- log row survives a hard-delete of the entity it describes.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  entity_type VARCHAR(40)  NOT NULL,
  entity_id   INTEGER      NOT NULL,
  action      VARCHAR(10)  NOT NULL,
  changes     JSONB        NOT NULL DEFAULT '{}',
  actor_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(120),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_audit_action CHECK (action IN ('created', 'updated', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);

-- ===========================================================================
-- Document revisions (see migration 022)
-- ---------------------------------------------------------------------------
-- The versions a revision-mode document type holds. A card carries several
-- versions; a version belongs to exactly one card, and at most one of them is
-- `production`.
--
-- Versions belong to the ENTITY, not to a product revision — a revision-mode
-- card shows one history whichever product revision is selected. Hence
-- `revision_mode` is only legal on an entity-scoped template (see the CHECKs
-- above), and the template id alone identifies the owning product /
-- sub-product, so there is no second FK to it.
--
-- Deliberately NOT built on `stored_files`: nothing is shared between versions,
-- so carry-forward / copy-on-write have nothing to do here.
--
-- Files live inside the entity's documents folder, at
-- `.../documents/revisions/{revisionId}-{Name}/`. That is inside the statically
-- served tree, and a card with no `allowed_extensions` accepts EVERY file
-- extension — so server.ts 404s any `/uploads/**` path containing a `revisions`
-- segment, ahead of the static mount. Removing that guard turns any uploaded
-- .html or .svg into stored XSS on the app's own origin.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS document_revisions (
  id                           SERIAL PRIMARY KEY,
  product_document_type_id     INTEGER REFERENCES product_document_types(id) ON DELETE CASCADE,
  sub_product_document_type_id INTEGER REFERENCES sub_product_document_types(id) ON DELETE CASCADE,
  name                         VARCHAR(120) NOT NULL,
  status                       VARCHAR(20)  NOT NULL DEFAULT 'testing'
                                 CHECK (status IN ('testing', 'production', 'deprecated')),
  release_notes                TEXT,
  created_by                   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_revisions_scope_chk
    CHECK ((product_document_type_id IS NULL) <> (sub_product_document_type_id IS NULL))
);

-- Keyed on LOWER(name), like the document-type name indexes: "v2.1" beside
-- "V2.1" is a duplicate to anyone reading the version list.
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revisions_pdt_name
  ON document_revisions(product_document_type_id, LOWER(name))
  WHERE product_document_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revisions_spdt_name
  ON document_revisions(sub_product_document_type_id, LOWER(name))
  WHERE sub_product_document_type_id IS NOT NULL;

-- "Only one production version per card", enforced by the database rather than
-- by application code.
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revisions_pdt_production
  ON document_revisions(product_document_type_id)
  WHERE status = 'production' AND product_document_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revisions_spdt_production
  ON document_revisions(sub_product_document_type_id)
  WHERE status = 'production' AND sub_product_document_type_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS document_revision_files (
  id                   SERIAL PRIMARY KEY,
  document_revision_id INTEGER NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
  storage_key          TEXT     NOT NULL,   -- path relative to uploads/products/
  original_name        VARCHAR(255) NOT NULL,
  size_bytes           BIGINT   NOT NULL,
  mime_type            VARCHAR(100),
  uploaded_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Also the conflict target for re-uploading a file of the same name: the row
-- is updated in place and the bytes overwritten.
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revision_files_storage_key
  ON document_revision_files(storage_key);

CREATE INDEX IF NOT EXISTS idx_document_revision_files_revision_id
  ON document_revision_files(document_revision_id);

-- ===========================================================================
-- Part alternatives (see migration 021)
-- ---------------------------------------------------------------------------
-- A part linked to ONE alternative part, scoped to one sub-product REVISION —
-- a link belongs to exactly one revision, the same way quantity, unit and
-- mount_position do. Duplicating a revision copies its links forward, same as
-- those fields; after that each revision's links are edited independently.
--
-- One alternate per part per revision, enforced by the unique index on
-- (sub_product_revision_id, part_id) — not a collection. Replacing a part's
-- alternate is a delete + insert on that pair.
--
-- Directional: `part_id` is the row being viewed, `alternate_part_id` is what
-- was linked to it. Linking A -> B does NOT make B show A as its alternative.
-- The unique index covers (revision, part_id) alone, so A and B may each
-- carry one independently. `CHECK (part_id <> alternate_part_id)` rules out
-- linking to itself.
--
-- CASCADEs on part_id/alternate_part_id (unlike sub_product_revision_parts,
-- which has no ON DELETE and so blocks deleting a part that's actually in a
-- BOM): a stray alternative link isn't a data-integrity risk the way an
-- orphaned BOM line would be, and that BOM protection already stands on its
-- own regardless of what this table does.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS part_alternatives (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  part_id                 INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  alternate_part_id       INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  -- Which of the pair this revision is actually built with. FALSE = the BOM
  -- line is fitted and the alternate is an approved standby; TRUE = this
  -- revision ships with the alternate instead. The BOM itself cannot answer
  -- this, since the alternate is a catalog part rather than a BOM row.
  -- DEFAULT FALSE guards the backfill in migration 021; the route creates new
  -- links with TRUE, since adding an alternative means you are using it.
  alternate_in_use        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_part_alternatives_not_self CHECK (part_id <> alternate_part_id)
);

-- The cardinality rule itself, and the lookup index for "this revision's
-- links" since it leads with sub_product_revision_id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_alternatives_one_per_part
  ON part_alternatives(sub_product_revision_id, part_id);
-- Both FKs cascade on delete, so each wants its own index.
CREATE INDEX IF NOT EXISTS idx_part_alternatives_part_id
  ON part_alternatives(part_id);
CREATE INDEX IF NOT EXISTS idx_part_alternatives_alternate_part_id
  ON part_alternatives(alternate_part_id);

-- ===========================================================================
-- Companies (see migration 009)
-- ---------------------------------------------------------------------------
-- The supplier list. Mirrored here — ahead of the rest of the stock-management
-- module, which still lives only in migrations 009-011 — because the projects
-- tables below reference it, and this file has to stand up on its own.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS companies (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================================================
-- Projects (see migration 023)
-- ---------------------------------------------------------------------------
-- A project pins product REVISIONS in `project_products`, then freezes their
-- flattened BOM into `project_parts` — one row per distinct part in the whole
-- project — with `project_part_usages` remembering every place that quantity
-- came from. The freeze is what makes the numbers stable: a draft sub-product
-- revision's parts can still be edited after the project started, so
-- re-deriving live would silently disagree with the stored `required_qty`.
--
-- `project_parts` carries NO status column, only quantities that add up:
--
--                     ┌─ from_stock_qty ─────────────┐
--   required_qty  ────┤                              ├──> prepared_qty
--                     └─ missing_qty ─> ordered_qty ─> received_qty
--
-- A part is routinely both partly in stock and partly short, and the shortfall
-- can be split across suppliers arriving on different days; one enum value
-- cannot say that, quantities can. Every status in the UI is a comparison
-- between these columns, and the three CHECK constraints keep the buckets
-- ordered, so no service has to remember the invariant.
--
-- The offer grid is the project's current quote sheet — companies are the
-- dynamic columns, prices the cells; there is no "offer round" entity. Orders
-- are created from that grid, one per company per "Order Parts" action.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  deadline    DATE,
  -- The whole edit/delete/stop rule: draft is editable and deletable, started
  -- is neither and may only be stopped, stopped and completed are terminal.
  status      VARCHAR(20) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'started', 'stopped', 'completed')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at  TIMESTAMPTZ,
  stopped_at  TIMESTAMPTZ
);

-- Names are deliberately not unique — two jobs for the same customer
-- legitimately share one.
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Lets the composite FK on project_products prove the revision belongs to the
-- product, instead of validating it in the service and hoping every future
-- writer remembers.
CREATE UNIQUE INDEX IF NOT EXISTS product_revisions_id_product_unique
  ON product_revisions (id, product_id);

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

-- One row per PART per project — the part appears once even when several
-- products need it. `required_qty` is the project's demand; `missing_qty` may
-- deliberately exceed `required_qty - from_stock_qty` when the buyer tops up
-- the shelf, so any cost or consumption figure for the project must use
-- `required_qty`, never `missing_qty`.
CREATE TABLE IF NOT EXISTS project_parts (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  part_id        INTEGER NOT NULL REFERENCES parts(id),

  -- Total needed by the project: SUM(bom qty x project_products.quantity).
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

-- One row per PLACE the part is used — a (product-in-the-project, sub-product
-- revision) pair, not just a product. The obvious alternative, a nullable
-- sub_product_revision_id with one row per product, cannot represent the
-- ordinary case of a part sitting in two sub-products of one product.
--
-- Neither the FK to `parts` above nor the one to `sub_product_revisions` here
-- carries an ON DELETE clause, so neither can be removed while a project still
-- claims it — the same protection `sub_product_revision_parts` already gives.
CREATE TABLE IF NOT EXISTS project_part_usages (
  id                      SERIAL PRIMARY KEY,
  project_part_id         INTEGER NOT NULL REFERENCES project_parts(id) ON DELETE CASCADE,
  project_product_id      INTEGER NOT NULL REFERENCES project_products(id) ON DELETE CASCADE,
  -- Which sub-product of that product the part sits in. Preparation builds its
  -- pick lists from it; backfilling it later would mean re-reading revisions
  -- that may have moved.
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id),
  qty_per_unit            NUMERIC(12,3) NOT NULL CHECK (qty_per_unit > 0),
  UNIQUE (project_part_id, project_product_id, sub_product_revision_id)
);

CREATE INDEX IF NOT EXISTS idx_project_part_usages_project_product
  ON project_part_usages(project_product_id);

-- The offer grid. A missing row and a NULL price mean the same thing (no
-- quote); the API writes a row only when the salesman types something, and a
-- cleared cell deletes its row. Zero is a real, distinct value — a free part.
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
  UNIQUE (project_id, company_id)
);

CREATE TABLE IF NOT EXISTS project_offer_prices (
  id                SERIAL PRIMARY KEY,
  offer_company_id  INTEGER NOT NULL REFERENCES project_offer_companies(id) ON DELETE CASCADE,
  project_part_id   INTEGER NOT NULL REFERENCES project_parts(id) ON DELETE CASCADE,
  -- Canonical EUR, NULL = this company did not quote this part.
  price_per_piece   NUMERIC(12,4) CHECK (price_per_piece >= 0),
  entered_amount    NUMERIC(12,4),
  entered_currency  CHAR(3) NOT NULL DEFAULT 'EUR' CHECK (entered_currency IN ('EUR','RON')),
  rate_used         NUMERIC(18,6),
  rate_date         DATE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (offer_company_id, project_part_id)
);

CREATE INDEX IF NOT EXISTS idx_project_offer_prices_part
  ON project_offer_prices(project_part_id);

-- One order per company per "Order Parts" action — the same click can place
-- three orders at three suppliers, which is what lets parts be ordered
-- separately from different companies.
--
-- Placing an order adds its line quantities to project_parts.ordered_qty in
-- the same transaction; receiving adds to order_lines.received_qty and
-- project_parts.received_qty, and writes an ordinary stock_entries row of
-- type = 'received' through the existing machinery, so the FIFO layer,
-- weighted average price and currency provenance keep working untouched.
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
  ordered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_lines (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  project_part_id INTEGER NOT NULL REFERENCES project_parts(id),
  part_id         INTEGER NOT NULL REFERENCES parts(id),
  quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  -- Copied from the accepted offer cell (canonical EUR) so a later re-quote
  -- cannot rewrite the price of an order already placed.
  price_per_piece NUMERIC(12,4),
  received_qty    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  UNIQUE (order_id, project_part_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON order_lines(order_id);
