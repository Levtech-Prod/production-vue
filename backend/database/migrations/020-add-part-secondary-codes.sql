-- Migration 020 — a part's alternate codes at other companies.
--
-- The same physical part is sometimes ordered under a different code at a
-- different company. `parts.code` stays the one required, unique identifier
-- used throughout the app (BOM lines, revisions, exports); `secondary_code`
-- is an optional, unordered list of the other codes the same part is known
-- by elsewhere. No uniqueness constraint: unlike `code`, a secondary code is
-- not guaranteed unique across parts or companies.
--
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/020-add-part-secondary-codes.sql
-- (idempotent — safe to re-run)

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS secondary_code TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
