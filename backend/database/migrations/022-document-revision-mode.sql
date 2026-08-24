-- Migration 022 — revision mode for document types (document-revision-plan.md).
--
-- Firmware stops being a feature of its own and becomes what it always was in
-- substance: one document type that happens to keep versions. Any document type
-- belonging to a single product / sub-product may now tick `revision_mode` and
-- hold versions instead of loose files.
--
-- Versions belong to the ENTITY, not to a product revision. That is the one
-- deliberate departure from firmware, whose versions hung off a
-- `sub_product_revision`: document revisions are a separate axis, so a
-- revision-mode card shows one history whichever product revision is selected.
-- Hence `revision_mode` is only legal on an entity-scoped template — a
-- type-scoped one is shared by every product of that type and has no single
-- history to own.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/022-document-revision-mode.sql
-- Idempotent — safe to re-run (the firmware step is guarded on the old tables
-- still existing).
--
-- One transaction: section 3 moves rows out of `firmwares` and then drops it.
-- A failure in between would lose them with no table left to re-read.

BEGIN;

-- ===========================================================================
-- 1. revision_mode on both template tables
-- ===========================================================================

ALTER TABLE product_document_types
  ADD COLUMN IF NOT EXISTS revision_mode BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE product_document_types
  DROP CONSTRAINT IF EXISTS product_document_types_revision_scope_chk;
ALTER TABLE product_document_types
  ADD CONSTRAINT product_document_types_revision_scope_chk
    CHECK (NOT revision_mode OR product_id IS NOT NULL);

ALTER TABLE sub_product_document_types
  ADD COLUMN IF NOT EXISTS revision_mode BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sub_product_document_types
  DROP CONSTRAINT IF EXISTS sub_product_document_types_revision_scope_chk;
ALTER TABLE sub_product_document_types
  ADD CONSTRAINT sub_product_document_types_revision_scope_chk
    CHECK (NOT revision_mode OR sub_product_id IS NOT NULL);

-- ===========================================================================
-- 2. The versions themselves
-- ===========================================================================
-- One pair of tables with two mutually exclusive FKs rather than four parallel
-- ones: the product and sub-product template families are already driven from a
-- single ScopeConfig in routes/documentTypes.ts, and the only thing that differs
-- here is which column the scope writes.
--
-- No FK to the owning product / sub-product: an entity-scoped template belongs
-- to exactly one of them, so the template id already identifies the owner.

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

-- "At most one production version per card", enforced by the database rather
-- than by application code. The API still demotes the incumbent when promoting
-- a new one; these are what make that correct under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revisions_pdt_production
  ON document_revisions(product_document_type_id)
  WHERE status = 'production' AND product_document_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revisions_spdt_production
  ON document_revisions(sub_product_document_type_id)
  WHERE status = 'production' AND sub_product_document_type_id IS NOT NULL;

-- Version files are NOT `stored_files`: nothing is shared between versions, so
-- the carry-forward / copy-on-write machinery has nothing to do here.
--
-- A revision-mode card with no `allowed_extensions` accepts every extension, so
-- these files are never statically served: they sit under
-- `.../documents/revisions/`, and server.ts 404s any `/uploads/**` path with a
-- `revisions` (or, for files migrated from firmware below, `firmware`) segment
-- ahead of the static mount. Removing that guard turns an uploaded .html or
-- .svg into stored XSS on the app's own origin.
CREATE TABLE IF NOT EXISTS document_revision_files (
  id                   SERIAL PRIMARY KEY,
  document_revision_id  INTEGER NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
  storage_key          TEXT     NOT NULL,   -- path relative to uploads/products/
  original_name        VARCHAR(255) NOT NULL,
  size_bytes           BIGINT   NOT NULL,
  mime_type            VARCHAR(100),
  uploaded_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The storage key is derived from the version folder plus the file name, so it
-- is also the natural conflict target for re-uploading a file of the same name:
-- the row is updated in place and the bytes overwritten.
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_revision_files_storage_key
  ON document_revision_files(storage_key);
CREATE INDEX IF NOT EXISTS idx_document_revision_files_revision_id
  ON document_revision_files(document_revision_id);

-- ===========================================================================
-- 3. Move the existing firmware onto the generic model
-- ===========================================================================
-- Dropped again at the end of this migration; it exists only to carry the old
-- id across so `firmware_files` can be re-pointed without matching on names.
ALTER TABLE document_revisions ADD COLUMN IF NOT EXISTS legacy_firmware_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'firmwares'
  ) THEN
    RETURN;
  END IF;

  -- Reusing a card of that name is fine while it is empty; turning one that
  -- already holds uploaded documents into a versioned card would hide them.
  IF EXISTS (
    SELECT 1
      FROM sub_product_document_types dt
      JOIN sub_product_revision_documents d ON d.document_type_id = dt.id
     WHERE dt.sub_product_id IS NOT NULL
       AND LOWER(dt.name) = 'firmware'
       AND NOT dt.revision_mode
       AND EXISTS (
             SELECT 1 FROM firmwares f
               JOIN sub_product_revisions spr ON spr.id = f.sub_product_revision_id
              WHERE spr.sub_product_id = dt.sub_product_id
           )
  ) THEN
    RAISE EXCEPTION
      'A "Firmware" document type already holds uploaded documents on a sub-product that also has firmware. Migration 022 would turn that card into a versioned one and hide them — rename the card, then re-run.';
  END IF;

  INSERT INTO sub_product_document_types
    (sub_product_id, name, icon, allowed_extensions, required, revision_mode, sort_order)
  SELECT sp.id, 'Firmware', 'cpu', '{}'::text[], FALSE, TRUE,
         COALESCE(
           (SELECT MAX(sort_order) + 1 FROM sub_product_document_types x
             WHERE x.sub_product_id = sp.id),
           0)
    FROM sub_products sp
   WHERE EXISTS (
           SELECT 1 FROM firmwares f
             JOIN sub_product_revisions spr ON spr.id = f.sub_product_revision_id
            WHERE spr.sub_product_id = sp.id
         )
  ON CONFLICT DO NOTHING;

  -- Covers the case the insert above skipped: an empty "Firmware" card that
  -- already existed on a sub-product which does have firmware.
  UPDATE sub_product_document_types dt
     SET revision_mode = TRUE
   WHERE dt.sub_product_id IS NOT NULL
     AND LOWER(dt.name) = 'firmware'
     AND NOT dt.revision_mode
     AND EXISTS (
           SELECT 1 FROM firmwares f
             JOIN sub_product_revisions spr ON spr.id = f.sub_product_revision_id
            WHERE spr.sub_product_id = dt.sub_product_id
         );

  -- Firmware names were unique per REVISION; collapsing a sub-product's
  -- revisions into one history can collide, so a colliding name takes its old
  -- revision label and, if that still collides, its old id. Likewise only one
  -- version can now be `production`, so the newest keeps the slot and the rest
  -- are deprecated — exactly what promoting one of them would have done.
  WITH scoped AS (
    SELECT f.id, f.name, f.status, f.release_notes, f.created_by,
           f.created_at, f.updated_at, spr.sub_product_id, spr.label
      FROM firmwares f
      JOIN sub_product_revisions spr ON spr.id = f.sub_product_revision_id
  ),
  marked AS (
    SELECT s.*,
           COUNT(*) OVER (PARTITION BY s.sub_product_id, LOWER(s.name)) AS name_count,
           COUNT(*) OVER (
             PARTITION BY s.sub_product_id, LOWER(s.name), LOWER(s.label)
           ) AS label_count,
           FIRST_VALUE(s.id) OVER (
             PARTITION BY s.sub_product_id
             ORDER BY (s.status = 'production') DESC, s.created_at DESC, s.id DESC
           ) AS top_id
      FROM scoped s
  )
  INSERT INTO document_revisions
    (sub_product_document_type_id, name, status, release_notes, created_by,
     created_at, updated_at, legacy_firmware_id)
  SELECT dt.id,
         LEFT(
           CASE
             WHEN m.name_count = 1  THEN m.name
             WHEN m.label_count = 1 THEN m.name || ' (' || m.label || ')'
             ELSE m.name || ' (' || m.label || ' #' || m.id || ')'
           END, 120),
         CASE
           WHEN m.status = 'production' AND m.id <> m.top_id THEN 'deprecated'
           ELSE m.status
         END,
         m.release_notes, m.created_by, m.created_at, m.updated_at, m.id
    FROM marked m
    JOIN sub_product_document_types dt
      ON dt.sub_product_id = m.sub_product_id
     AND LOWER(dt.name) = 'firmware'
     AND dt.revision_mode;

  -- Storage keys are carried over verbatim: nothing moves on disk, and the
  -- `firmware` segment they contain keeps them unserved under the same guard.
  -- New uploads land under `documents/revisions/`.
  INSERT INTO document_revision_files
    (document_revision_id, storage_key, original_name, size_bytes, mime_type,
     uploaded_by, created_at)
  SELECT dr.id, ff.storage_key, ff.original_name, ff.size_bytes, ff.mime_type,
         ff.uploaded_by, ff.created_at
    FROM firmware_files ff
    JOIN document_revisions dr ON dr.legacy_firmware_id = ff.firmware_id;

  DROP TABLE firmware_files;
  DROP TABLE firmwares;
END $$;

ALTER TABLE document_revisions DROP COLUMN IF EXISTS legacy_firmware_id;

COMMIT;
