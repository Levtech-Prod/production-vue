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
  image       TEXT NOT NULL,
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
  image       TEXT NOT NULL,
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

-- ===========================================================================
-- Documents module
-- Files attached to products (product-level) or sub-product revisions.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS product_documents (
  id            SERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  filename      VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100),
  path          TEXT NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_product_revision_documents (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  original_name           VARCHAR(255) NOT NULL,
  filename                VARCHAR(255) NOT NULL,
  mime_type               VARCHAR(100),
  path                    TEXT NOT NULL,
  uploaded_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_documents_product_id ON product_documents(product_id);
CREATE INDEX IF NOT EXISTS idx_sp_rev_documents_sp_rev_id ON sub_product_revision_documents(sub_product_revision_id);

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
