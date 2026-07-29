-- Extend stock_entries to track both received and removed stock movements
-- in a single table, distinguished by a `type` column.
--
-- received: a batch purchased from a company; consumed gradually via FIFO.
-- removed:  a manual removal from stock; always records a note, never a company/price.

-- 1. Track FIFO consumption on received entries
ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS quantity_consumed NUMERIC(10, 3) NOT NULL DEFAULT 0;

-- 2. Type discriminator (all existing rows are 'received')
ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS type VARCHAR(10) NOT NULL DEFAULT 'received';

ALTER TABLE stock_entries
  ADD CONSTRAINT chk_stock_entry_type CHECK (type IN ('received', 'removed'));

-- 3. Note field for removal events (NULL on received entries)
ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS note TEXT;

-- 4. Make received-only columns nullable so removal rows can omit them
ALTER TABLE stock_entries ALTER COLUMN company_id     DROP NOT NULL;
ALTER TABLE stock_entries ALTER COLUMN price_per_piece DROP NOT NULL;

-- 5. Enforce type-specific field requirements at the DB level
ALTER TABLE stock_entries
  ADD CONSTRAINT chk_received_requires_company
    CHECK (type != 'received' OR company_id IS NOT NULL);

ALTER TABLE stock_entries
  ADD CONSTRAINT chk_received_requires_price
    CHECK (type != 'received' OR price_per_piece IS NOT NULL);

ALTER TABLE stock_entries
  ADD CONSTRAINT chk_removed_requires_note
    CHECK (type != 'removed' OR (note IS NOT NULL AND length(trim(note)) > 0));

ALTER TABLE stock_entries
  ADD CONSTRAINT chk_removed_no_consumed
    CHECK (type != 'removed' OR quantity_consumed = 0);

-- 6. Composite index for type-filtered queries (FIFO, avgPrice, totalQty)
CREATE INDEX IF NOT EXISTS idx_stock_entries_part_type ON stock_entries(part_id, type);
