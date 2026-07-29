import type { EntryCurrency } from './parts.ts';

export interface StockEntry {
  id: number;
  partId: number;
  type: 'received' | 'removed';
  /** Non-null for received entries; null for removals. */
  company: { id: number; name: string } | null;
  quantity: number;
  /** Amount consumed by FIFO removals. Always 0 for removed entries. */
  quantityConsumed: number;
  /** Canonical price in EUR. Non-null for received entries; null for removals. */
  pricePerPiece: number | null;
  /** How the price was entered (provenance). Null for removals. */
  enteredAmount: number | null;
  enteredCurrency: EntryCurrency | null;
  /** RON-per-EUR rate applied; null when entered in EUR or for removals. */
  rateUsed: number | null;
  /** BNR rate date applied (YYYY-MM-DD); null when entered in EUR or removals. */
  rateDate: string | null;
  /** Non-null for removed entries; null for received entries. */
  note: string | null;
  enteredBy: { id: number; username: string } | null;
  enteredAt: string;
}

/**
 * Response from creating a stock entry. `affectedReceived` holds received rows
 * whose `quantityConsumed` changed (a FIFO removal draws them down); it is
 * empty for a received entry. The client patches these into its cache so no
 * refetch is needed after a removal.
 */
export interface StockEntryResult {
  entry: StockEntry;
  affectedReceived: StockEntry[];
}

export type CreateStockEntryPayload =
  | {
      type: 'received';
      partId: number;
      companyId: number;
      quantity: number;
      pricePerPiece: { amount: number; currency: EntryCurrency };
    }
  | {
      type: 'removed';
      partId: number;
      quantity: number;
      note: string;
    };
