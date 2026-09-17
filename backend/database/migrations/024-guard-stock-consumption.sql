-- Guard stock_entries.quantity_consumed against ever exceeding quantity, at
-- the database level rather than relying only on the FIFO write path.
--
-- NOT in projects-preparation-plan.md (see its §11.8) — added while building
-- services/projectStock.ts. That service's available-stock query sums
-- (quantity - quantity_consumed) per part with no per-row floor, matching
-- the pattern routes/parts.ts already uses. That sum is only equivalent to
-- frontend/src/utils/stock.ts's per-row-clamped availableOf() as long as no
-- single row is ever over-consumed. routes/stockEntries.ts's FIFO deduction
-- already guarantees that in practice (it deducts under a row lock via
-- Math.min(remaining, available) and never drives a row negative) but
-- nothing in the schema made it impossible. This constraint closes that gap:
-- the two call sites can no longer silently disagree, because the state that
-- would make them disagree can no longer exist.
--
-- `db:migrate` re-runs every migration on every run with no ledger, so the
-- DROP-then-ADD shape from migration 010 is repeated here for idempotency.
--
-- Run: psql "$DATABASE_URL" -f database/migrations/024-guard-stock-consumption.sql
-- Idempotent — safe to re-run. If this ever fails on an existing database,
-- some row already has quantity_consumed > quantity — exactly the
-- corruption this constraint exists to rule out; that data needs fixing
-- before the migration can apply, not the other way around.

BEGIN;

ALTER TABLE stock_entries
  DROP CONSTRAINT IF EXISTS chk_stock_entry_consumed_within_quantity;
ALTER TABLE stock_entries
  ADD CONSTRAINT chk_stock_entry_consumed_within_quantity
    CHECK (quantity_consumed <= quantity);

COMMIT;
