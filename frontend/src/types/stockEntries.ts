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
