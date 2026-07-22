-- Migration 006 — Strip absolute URLs from stored image paths.
-- The /api/upload/:target route used to build an absolute URL from
-- req.protocol + req.get('host'), which behind the nginx reverse proxy
-- resolved to the internal Docker network address (e.g. 172.18.0.1) rather
-- than anything a browser could reach. It now returns a relative path only
-- (e.g. /uploads/parts/xyz.png), which the frontend already resolves
-- correctly against its own origin. This migration rewrites any
-- previously-stored absolute URLs down to that same relative form so
-- existing images render again.
-- Run once against the existing database:
--   psql "$DATABASE_URL" -f database/migrations/006-strip-absolute-urls-from-image-columns.sql
-- (idempotent — safe to re-run; only touches values starting with http)

UPDATE part_categories
SET image = regexp_replace(image, '^https?://[^/]+', '')
WHERE image LIKE 'http%';

UPDATE parts
SET image = regexp_replace(image, '^https?://[^/]+', '')
WHERE image LIKE 'http%';

UPDATE products
SET image = regexp_replace(image, '^https?://[^/]+', '')
WHERE image LIKE 'http%';

UPDATE sub_products
SET image = regexp_replace(image, '^https?://[^/]+', '')
WHERE image LIKE 'http%';
