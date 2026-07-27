-- ===========================================================================
-- Stock Management module
-- ---------------------------------------------------------------------------
-- Adds two tables:
--   companies      — supplier/vendor list referenced by stock entries
--   stock_entries  — immutable log of parts received into stock
--                    (who entered it, when, from which company, qty, price)
--
-- parts.price_per_piece is retained as the manually-set fallback price.
-- The API computes avgPricePerPiece and totalQuantity at read time via
-- correlated subqueries so no triggers or computed columns are needed.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS companies (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_entries (
  id              SERIAL PRIMARY KEY,
  part_id         INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  quantity        NUMERIC(10, 3) NOT NULL CHECK (quantity > 0),
  price_per_piece NUMERIC(12, 2) NOT NULL CHECK (price_per_piece >= 0),
  entered_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_entries_part_id    ON stock_entries(part_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_company_id ON stock_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_entered_at ON stock_entries(entered_at DESC);
