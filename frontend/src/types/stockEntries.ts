import type { Company } from './companies.ts';

export interface StockEntry {
  id: number;
  partId: number;
  company: Pick<Company, 'id' | 'name'>;
  quantity: number;
  pricePerPiece: number;
  enteredBy: { id: number; username: string } | null;
  enteredAt: string;
}

export interface CreateStockEntryPayload {
  partId: number;
  companyId: number;
  quantity: number;
  pricePerPiece: number;
}
