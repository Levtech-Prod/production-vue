-- ===========================================================================
-- Multi-currency part pricing (EUR canonical, EUR/RON entry via BNR)
-- ---------------------------------------------------------------------------
-- All part prices are stored canonically in EUR. Users may enter a price in
-- EUR or RON; a RON amount is converted to EUR using the BNR (Banca Nationala
-- a Romaniei) reference rate for the entry date, frozen at write time.
--
-- Adds:
--   exchange_rates          — cache of BNR reference rates (RON per 1 unit).
--   provenance columns      — on stock_entries and parts: the amount/currency
--                             the user actually typed, plus the rate + rate
--                             date applied. price_per_piece stays canonical EUR.
--
-- EUR money columns are widened from NUMERIC(12,2) to NUMERIC(12,4) so the
-- converted canonical value keeps more precision than 2 euro-cent decimals.
-- ===========================================================================

-- --- Rates cache ----------------------------------------------------------
-- rate = RON per 1 unit of `currency` (BNR quotes RON as the origin currency).
CREATE TABLE IF NOT EXISTS exchange_rates (
  rate_date  DATE          NOT NULL,
  currency   CHAR(3)       NOT NULL,
  rate       NUMERIC(18, 6) NOT NULL CHECK (rate > 0),
  fetched_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rate_date, currency)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date
  ON exchange_rates (currency, rate_date DESC);

-- --- stock_entries: widen EUR column + add provenance ---------------------
ALTER TABLE stock_entries
  ALTER COLUMN price_per_piece TYPE NUMERIC(12, 4);

ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS entered_amount   NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS entered_currency CHAR(3) NOT NULL DEFAULT 'EUR'
    CHECK (entered_currency IN ('EUR', 'RON')),
  ADD COLUMN IF NOT EXISTS rate_used        NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS rate_date        DATE;

-- Existing received rows were entered directly in EUR.
UPDATE stock_entries
  SET entered_amount = price_per_piece
  WHERE entered_amount IS NULL AND price_per_piece IS NOT NULL;

-- --- parts (manual fallback price): widen EUR column + add provenance ------
ALTER TABLE parts
  ALTER COLUMN price_per_piece TYPE NUMERIC(12, 4);

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS price_entered_amount   NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS price_entered_currency CHAR(3) NOT NULL DEFAULT 'EUR'
    CHECK (price_entered_currency IN ('EUR', 'RON')),
  ADD COLUMN IF NOT EXISTS price_rate_used        NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS price_rate_date        DATE;

UPDATE parts
  SET price_entered_amount = price_per_piece
  WHERE price_entered_amount IS NULL;
