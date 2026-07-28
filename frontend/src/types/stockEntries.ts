export interface StockEntry {
  id: number;
  partId: number;
  type: 'received' | 'removed';
  /** Non-null for received entries; null for removals. */
  company: { id: number; name: string } | null;
  quantity: number;
  /** Amount consumed by FIFO removals. Always 0 for removed entries. */
  quantityConsumed: number;
  /** Non-null for received entries; null for removals. */
  pricePerPiece: number | null;
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
      pricePerPiece: number;
    }
  | {
      type: 'removed';
      partId: number;
      quantity: number;
      note: string;
    };
