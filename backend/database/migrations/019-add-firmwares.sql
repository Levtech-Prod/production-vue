-- Migration 019 — firmware versions per sub-product revision.
--
-- A firmware belongs to exactly ONE sub-product revision: a revision can carry
-- several firmwares, but a firmware is never shared across revisions. Hence a
-- plain FK rather than a junction table.
--
-- `ux_firmwares_one_production` is the whole "only one production firmware per
-- revision" rule, enforced by the database instead of by application code. The
-- API still demotes the previous production row when promoting a new one; the
-- index is what makes that correct under concurrency rather than merely usual.
--
-- Firmware files are NOT `stored_files`: nothing is shared between firmwares,
-- so the carry-forward / copy-on-write machinery has nothing to do here.
--
-- They live beside the sub-product's documents, at
-- `uploads/products/{product}/sub-products/{sub}/documents/firmware/{id}-{ver}/`
-- — inside the statically served tree. Firmware accepts EVERY extension, so
-- server.ts 404s any `/uploads/**` path containing a `firmware` segment ahead
-- of the static mount; removing that guard turns an uploaded .html or .svg
-- into stored XSS on the app's own origin.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/019-add-firmwares.sql
-- (idempotent — safe to re-run)

CREATE TABLE IF NOT EXISTS firmwares (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL
                            REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  name                    VARCHAR(120) NOT NULL,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'testing'
                            CHECK (status IN ('testing', 'production', 'deprecated')),
  release_notes           TEXT,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keyed on LOWER(name), like the document-type name indexes: "v2.1" beside
-- "V2.1" is a duplicate to anyone reading the version list.
CREATE UNIQUE INDEX IF NOT EXISTS ux_firmwares_revision_name
  ON firmwares(sub_product_revision_id, LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS ux_firmwares_one_production
  ON firmwares(sub_product_revision_id) WHERE status = 'production';

-- No plain index on sub_product_revision_id: ux_firmwares_revision_name above
-- already leads with that column, so every lookup by revision uses it.
DROP INDEX IF EXISTS idx_firmwares_revision_id;

CREATE TABLE IF NOT EXISTS firmware_files (
  id            SERIAL PRIMARY KEY,
  firmware_id   INTEGER NOT NULL REFERENCES firmwares(id) ON DELETE CASCADE,
  storage_key   TEXT     NOT NULL,   -- path relative to uploads/products/
  original_name VARCHAR(255) NOT NULL,
  size_bytes    BIGINT   NOT NULL,
  mime_type     VARCHAR(100),
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The storage key is derived from the firmware folder plus the file name, so
-- it is also the natural conflict target for re-uploading a file of the same
-- name: the row is updated in place and the bytes overwritten.
CREATE UNIQUE INDEX IF NOT EXISTS ux_firmware_files_storage_key
  ON firmware_files(storage_key);

CREATE INDEX IF NOT EXISTS idx_firmware_files_firmware_id
  ON firmware_files(firmware_id);
