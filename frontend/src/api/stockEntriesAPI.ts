import { api } from './client.ts';
import type { StockEntry, CreateStockEntryPayload } from '../types/stockEntries.ts';

export const stockEntriesApi = {
  getByPartId(partId: number) {
    return api.get<StockEntry[]>('/stock-entries', { params: { partId } });
  },

  create(payload: CreateStockEntryPayload) {
    return api.post<StockEntry>('/stock-entries', payload);
  },
};
