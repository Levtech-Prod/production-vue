-- Migration 016 — document types can be scoped to a single product /
-- sub-product, not only to its TYPE.
--
-- Migration 013 defined every document requirement per product / sub-product
-- TYPE, so a card added for one product appeared on every product sharing that
-- type. A requirement that is genuinely one product's own had nowhere to live.
--
-- Each template table gains an entity FK alongside the existing type FK, and
-- exactly one of the two is set:
--
--   product_type_id set -> the type-level template (unchanged behaviour)
--   product_id      set -> this one product only
--
-- The type FK becomes NULLABLE rather than being filled in as well. Templates
-- are reached through `product_types.name = products.type` (see
-- documentFiles.ts), so a product-scoped row that also carried a type id would
-- disappear from its own panel the moment the product's `type` was changed —
-- the row belongs to the product, and only the product.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/016-per-entity-document-types.sql
-- Idempotent — safe to re-run.
--
-- Wrapped in a transaction: the UNIQUE constraint each table currently carries
-- is dropped and replaced by two partial indexes. A failure between those steps
-- would leave the table with no uniqueness rule at all.

BEGIN;

-- ===========================================================================
-- 1. Product document types
-- ===========================================================================

ALTER TABLE product_document_types
  ALTER COLUMN product_type_id DROP NOT NULL;

ALTER TABLE product_document_types
  ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE CASCADE;

-- Exactly one scope, never both and never neither. `<>` on two booleans is XOR.
ALTER TABLE product_document_types
  DROP CONSTRAINT IF EXISTS product_document_types_scope_chk;
ALTER TABLE product_document_types
  ADD CONSTRAINT product_document_types_scope_chk
    CHECK ((product_type_id IS NULL) <> (product_id IS NULL));

-- The old table-level UNIQUE(product_type_id, name) can no longer be the whole
-- rule: it says nothing about product-scoped rows, whose product_type_id is
-- NULL (and in Postgres every NULL is distinct, so it would not constrain them
-- at all). Two partial unique indexes, one per scope, replace it.
--
-- Keyed on LOWER(name), not name: these are labels on cards, and "Datasheet"
-- beside "datasheet" is a duplicate to every human who reads the panel. It also
-- keeps the database in step with the API's own cross-scope check, which
-- compares case-insensitively (routes/documentTypes.ts, nameTaken) — a
-- case-sensitive index would have accepted from Settings exactly what the panel
-- rejects.
--
-- Name collisions BETWEEN the two scopes — a product-scoped card named like one
-- the product already inherits from its type — are not expressible as a
-- constraint (the type is reached through a join) and are rejected by the API.
ALTER TABLE product_document_types
  DROP CONSTRAINT IF EXISTS product_document_types_product_type_id_name_key;

-- Names that were legal under the old case-SENSITIVE rule but collide under
-- the new one would make the index creation below fail on a constraint
-- violation naming a row id and nothing else. Fail first, saying which names.
DO $$
DECLARE conflicting TEXT;
BEGIN
  SELECT string_agg(name, ', ') INTO conflicting
  FROM (
    SELECT MIN(name) AS name
    FROM product_document_types
    GROUP BY product_type_id, product_id, LOWER(name)
    HAVING COUNT(*) > 1
  ) d;

  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION
      'product_document_types holds document type names differing only in case (%). Rename them so each is unique case-insensitively, then re-run this migration.',
      conflicting;
  END IF;
END $$;

-- Dropped before creating, unlike the plain `IF NOT EXISTS` indexes below:
-- an earlier run of this migration created these same names keyed on `name`,
-- and `IF NOT EXISTS` would keep that older definition without a word.
DROP INDEX IF EXISTS ux_product_document_types_type_name;
CREATE UNIQUE INDEX ux_product_document_types_type_name
  ON product_document_types(product_type_id, LOWER(name))
  WHERE product_type_id IS NOT NULL;

DROP INDEX IF EXISTS ux_product_document_types_product_name;
CREATE UNIQUE INDEX ux_product_document_types_product_name
  ON product_document_types(product_id, LOWER(name))
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_document_types_product_id
  ON product_document_types(product_id);

-- ===========================================================================
-- 2. Sub-product document types — same change, same reasoning
-- ===========================================================================

ALTER TABLE sub_product_document_types
  ALTER COLUMN sub_product_type_id DROP NOT NULL;

ALTER TABLE sub_product_document_types
  ADD COLUMN IF NOT EXISTS sub_product_id INTEGER
    REFERENCES sub_products(id) ON DELETE CASCADE;

ALTER TABLE sub_product_document_types
  DROP CONSTRAINT IF EXISTS sub_product_document_types_scope_chk;
ALTER TABLE sub_product_document_types
  ADD CONSTRAINT sub_product_document_types_scope_chk
    CHECK ((sub_product_type_id IS NULL) <> (sub_product_id IS NULL));

ALTER TABLE sub_product_document_types
  DROP CONSTRAINT IF EXISTS sub_product_document_types_sub_product_type_id_name_key;

DO $$
DECLARE conflicting TEXT;
BEGIN
  SELECT string_agg(name, ', ') INTO conflicting
  FROM (
    SELECT MIN(name) AS name
    FROM sub_product_document_types
    GROUP BY sub_product_type_id, sub_product_id, LOWER(name)
    HAVING COUNT(*) > 1
  ) d;

  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION
      'sub_product_document_types holds document type names differing only in case (%). Rename them so each is unique case-insensitively, then re-run this migration.',
      conflicting;
  END IF;
END $$;

DROP INDEX IF EXISTS ux_sub_product_document_types_type_name;
CREATE UNIQUE INDEX ux_sub_product_document_types_type_name
  ON sub_product_document_types(sub_product_type_id, LOWER(name))
  WHERE sub_product_type_id IS NOT NULL;

DROP INDEX IF EXISTS ux_sub_product_document_types_sp_name;
CREATE UNIQUE INDEX ux_sub_product_document_types_sp_name
  ON sub_product_document_types(sub_product_id, LOWER(name))
  WHERE sub_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sub_product_document_types_sub_product_id
  ON sub_product_document_types(sub_product_id);

COMMIT;
