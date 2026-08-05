-- Migration 013 — Required Document Types (document-system-plan.md, Story 1).
--
-- Upgrades the document system so requirements are defined once per product /
-- sub-product TYPE (template tables), each physical file is stored once
-- (`stored_files`), and thin per-revision rows point at a stored file + a
-- document type. Product docs move from product-level to per **product
-- revision**.
--
-- Schema only — there is no data migration: the legacy document tables are
-- empty in every environment, so a backfill would be code that never runs.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/013-document-requirements.sql
-- Idempotent — safe to re-run.
--
-- Wrapped in a single transaction: DDL is transactional in Postgres, and step 3
-- RENAMEs `sub_product_revision_documents` aside before creating the reshaped
-- table under that name. Without the transaction, a failure between those two
-- statements would leave no table under the canonical name at all — and the
-- rename guard would stop a re-run from repairing it.

BEGIN;

-- ===========================================================================
-- 1. Templates — required document types defined per product / sub-product type
-- ===========================================================================

CREATE TABLE IF NOT EXISTS product_document_types (
  id                 SERIAL PRIMARY KEY,
  product_type_id    INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
  name               VARCHAR(120) NOT NULL,
  icon               VARCHAR(60)  NOT NULL,            -- lucide-vue-next icon name
  allowed_extensions TEXT[] NOT NULL DEFAULT '{}',     -- e.g. {'.zip'}; empty = any
  required           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_type_id, name)
);

CREATE TABLE IF NOT EXISTS sub_product_document_types (
  id                  SERIAL PRIMARY KEY,
  sub_product_type_id INTEGER NOT NULL REFERENCES sub_product_types(id) ON DELETE CASCADE,
  name                VARCHAR(120) NOT NULL,
  icon                VARCHAR(60)  NOT NULL,
  allowed_extensions  TEXT[] NOT NULL DEFAULT '{}',
  required            BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sub_product_type_id, name)
);

CREATE INDEX IF NOT EXISTS idx_product_document_types_type_id
  ON product_document_types(product_type_id);
CREATE INDEX IF NOT EXISTS idx_sub_product_document_types_type_id
  ON sub_product_document_types(sub_product_type_id);

-- ===========================================================================
-- 2. Stored files — each physical file recorded once, shared by pointer
-- ===========================================================================
-- One row per physical file. Files are shared across revisions by having
-- several revision-document rows point at the same stored_files.id — nothing is
-- copied on disk. No content hashing in v1 (see plan §7 for phase-2 dedup).

CREATE TABLE IF NOT EXISTS stored_files (
  id          SERIAL PRIMARY KEY,
  storage_key TEXT     NOT NULL,       -- relative path within uploads/documents/
  size_bytes  BIGINT   NOT NULL,
  mime_type   VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE, not just indexed: "one row per physical file" is the invariant the
-- whole sharing model rests on — carry-forward and copy-on-write are only safe
-- because a storage_key identifies exactly one stored_files row. The upload
-- path already guarantees it (resolveUniqueName never reuses an on-disk name);
-- this makes the database say so too, so a future code path cannot quietly
-- break it. Drops the earlier non-unique index it replaces.
DROP INDEX IF EXISTS idx_stored_files_storage_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_stored_files_storage_key
  ON stored_files(storage_key);

-- ===========================================================================
-- 3. Per-revision document rows point at a stored file + a document type
-- ===========================================================================
-- document_type_id NULL = the ad-hoc "Other documents" bucket.

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
-- Backs the stateless "is anything else pointing at this file?" cleanup check.
CREATE INDEX IF NOT EXISTS idx_prod_rev_docs_stored_file_id
  ON product_revision_documents(stored_file_id);

-- Reshape sub_product_revision_documents. The new table reuses the canonical
-- name, so the old one has to go first. Guarded on the presence of the legacy
-- `filename` column — only the old shape has it — so a re-run skips this
-- entirely rather than touching the already-reshaped table.
--
-- Dropped rather than renamed aside: the table is empty, so there is no data a
-- `_legacy` copy could preserve, and keeping one would leave a dead table
-- behind for a follow-up migration to clean up. The row check makes the
-- "it's empty" assumption explicit — if it is ever wrong, this fails loudly
-- and the whole migration rolls back, instead of silently hiding rows in a
-- table no code reads.
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sub_product_revision_documents' AND column_name = 'filename'
      )
  THEN
    IF EXISTS (SELECT 1 FROM sub_product_revision_documents) THEN
      RAISE EXCEPTION
        'sub_product_revision_documents holds rows; migration 013 expects it empty. Write a backfill migration before running this.';
    END IF;
    DROP TABLE sub_product_revision_documents;
  END IF;
END $$;

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

-- ===========================================================================
-- 4. Retire product_documents
-- ===========================================================================
-- Product documents are now per product REVISION (section 3), so the old
-- product-level table has no reader left in backend/src. Same guard and same
-- reasoning as the sub-product table above: empty, so nothing to preserve —
-- and a loud failure rather than a silent one if that is ever untrue.

DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'product_documents'
      )
  THEN
    IF EXISTS (SELECT 1 FROM product_documents) THEN
      RAISE EXCEPTION
        'product_documents holds rows; migration 013 expects it empty. Write a backfill migration before running this.';
    END IF;
    DROP TABLE product_documents;
  END IF;
END $$;

COMMIT;
