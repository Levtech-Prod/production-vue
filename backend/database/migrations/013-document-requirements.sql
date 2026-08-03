-- Migration 013 — Required Document Types (document-system-plan.md, Story 1).
--
-- Upgrades the document system so requirements are defined once per product /
-- sub-product TYPE (template tables), each physical file is stored once
-- (`stored_files`), and thin per-revision rows point at a stored file + a
-- document type. Product docs move from product-level to per **product
-- revision**. Existing data is migrated into the new shape; the old tables are
-- retained one release for rollback.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/013-document-requirements.sql
-- Idempotent — safe to re-run.

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
-- `storage_key` is the file's path relative to uploads/documents/ (matches the
-- legacy `filename` column, so no files are moved during migration).

CREATE TABLE IF NOT EXISTS stored_files (
  id          SERIAL PRIMARY KEY,
  storage_key TEXT     NOT NULL,       -- relative path within uploads/documents/
  size_bytes  BIGINT   NOT NULL,       -- 0 for legacy rows (unknown at migration)
  mime_type   VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Speeds folder resolution and the migration's storage_key lookups below.
CREATE INDEX IF NOT EXISTS idx_stored_files_storage_key ON stored_files(storage_key);

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
-- name, so move the old one aside first. Guarded on the presence of the legacy
-- `filename` column (only the old shape has it) and the absence of an existing
-- legacy table, so re-running never renames the already-reshaped table.
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sub_product_revision_documents' AND column_name = 'filename'
      )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'sub_product_revision_documents_legacy'
      )
  THEN
    ALTER TABLE sub_product_revision_documents
      RENAME TO sub_product_revision_documents_legacy;
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
-- 4. Data migration — move existing docs into the new shape (no files moved)
-- ===========================================================================
-- Each block is idempotent. The two backfill blocks are guarded on the target
-- table being empty so they never double-insert on re-run; stored_files inserts
-- are guarded on storage_key so files are recorded once.

-- 4a. Products that have documents but no revision yet: auto-create Rev.1 so the
--     revision-scoped docs have somewhere to live, and point default at it.
INSERT INTO product_revisions (product_id, revision_number, label, status, change_notes)
SELECT DISTINCT pd.product_id, 1, 'Rev.1', 'draft', 'Auto-created during document migration (013)'
FROM product_documents pd
WHERE NOT EXISTS (
  SELECT 1 FROM product_revisions pr WHERE pr.product_id = pd.product_id
);

UPDATE products p
SET default_revision_id = (
  SELECT pr.id FROM product_revisions pr
  WHERE pr.product_id = p.id
  ORDER BY pr.revision_number
  LIMIT 1
)
WHERE p.default_revision_id IS NULL
  AND EXISTS (SELECT 1 FROM product_documents pd WHERE pd.product_id = p.id)
  AND EXISTS (SELECT 1 FROM product_revisions pr WHERE pr.product_id = p.id);

-- 4b. Sub-product revision documents: one stored_files row per legacy file, then
--     a reshaped document row (document_type_id NULL -> "Other" bucket).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'sub_product_revision_documents_legacy')
     AND NOT EXISTS (SELECT 1 FROM sub_product_revision_documents)
  THEN
    INSERT INTO stored_files (storage_key, size_bytes, mime_type, created_at)
    SELECT l.filename, 0, l.mime_type, l.created_at
    FROM sub_product_revision_documents_legacy l
    WHERE NOT EXISTS (
      SELECT 1 FROM stored_files sf WHERE sf.storage_key = l.filename
    );

    INSERT INTO sub_product_revision_documents
      (sub_product_revision_id, document_type_id, stored_file_id, original_name, uploaded_by, created_at)
    SELECT l.sub_product_revision_id, NULL, sf.id, l.original_name, l.uploaded_by, l.created_at
    FROM sub_product_revision_documents_legacy l
    JOIN stored_files sf ON sf.storage_key = l.filename;
  END IF;
END $$;

-- 4c. Product documents: one stored_files row per legacy file, then a document
--     row on the product's default (else earliest) revision. Products with no
--     revision were given one in 4a, so every product doc has a target here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM product_revision_documents) THEN
    INSERT INTO stored_files (storage_key, size_bytes, mime_type, created_at)
    SELECT pd.filename, 0, pd.mime_type, pd.created_at
    FROM product_documents pd
    WHERE NOT EXISTS (
      SELECT 1 FROM stored_files sf WHERE sf.storage_key = pd.filename
    );

    INSERT INTO product_revision_documents
      (product_revision_id, document_type_id, stored_file_id, original_name, uploaded_by, created_at)
    SELECT t.rev_id, NULL, sf.id, pd.original_name, pd.uploaded_by, pd.created_at
    FROM product_documents pd
    JOIN stored_files sf ON sf.storage_key = pd.filename
    JOIN LATERAL (
      SELECT COALESCE(
        p.default_revision_id,
        (SELECT pr.id FROM product_revisions pr
         WHERE pr.product_id = pd.product_id
         ORDER BY pr.revision_number LIMIT 1)
      ) AS rev_id
      FROM products p WHERE p.id = pd.product_id
    ) t ON TRUE
    WHERE t.rev_id IS NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Rollback note: the legacy tables are intentionally retained for one release.
--   * product_documents                        (unchanged, still populated)
--   * sub_product_revision_documents_legacy     (renamed from the old table)
-- A follow-up migration drops them once the new document routes have shipped
-- and been verified in production.
-- ---------------------------------------------------------------------------
