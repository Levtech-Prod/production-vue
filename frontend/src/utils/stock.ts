/**
 * Shared stock-math helpers. The available-stock rule (received quantity minus
 * FIFO-consumed amount) and the weighted-average price live here so the parts
 * store and the part detail panel compute them identically.
 */
import type { StockEntry } from '../types/stockEntries.ts';

/** Remaining available quantity on a received entry after FIFO removals. */
export function availableOf(entry: StockEntry): number {
  return Math.max(0, Number(entry.quantity) - Number(entry.quantityConsumed ?? 0));
}

export interface StockSummary {
  totalQuantity: number;
  /** Weighted average price per available piece; null when there is no stock. */
  avgPricePerPiece: number | null;
}

/** Total available quantity and weighted-average price from received entries. */
export function summarizeStock(entries: StockEntry[]): StockSummary {
  let totalQuantity = 0;
  let totalValue = 0;
  for (const e of entries) {
    if (e.type !== 'received') continue;
    const available = availableOf(e);
    totalQuantity += available;
    totalValue += Number(e.pricePerPiece ?? 0) * available;
  }
  return {
    totalQuantity,
    avgPricePerPiece: totalQuantity > 0 ? totalValue / totalQuantity : null,
  };
}

export interface CompanyStockRow {
  companyId: number;
  companyName: string;
  totalQty: number;
  avgPrice: number;
}

/** Available stock per company, weighted avg price, sorted alphabetically. */
export function stockByCompany(entries: StockEntry[]): CompanyStockRow[] {
  const map = new Map<
    number,
    { companyId: number; companyName: string; totalQty: number; totalValue: number }
  >();
  for (const e of entries) {
    if (e.type !== 'received' || !e.company) continue;
    const available = availableOf(e);
    if (available === 0) continue; // fully consumed — exclude from breakdown
    const existing = map.get(e.company.id);
    if (existing) {
      existing.totalQty += available;
      existing.totalValue += Number(e.pricePerPiece ?? 0) * available;
    } else {
      map.set(e.company.id, {
        companyId: e.company.id,
        companyName: e.company.name,
        totalQty: available,
        totalValue: Number(e.pricePerPiece ?? 0) * available,
      });
    }
  }
  return [...map.values()]
    .sort((a, b) => a.companyName.localeCompare(b.companyName))
    .map(({ totalValue, ...row }) => ({
      ...row,
      avgPrice: row.totalQty > 0 ? totalValue / row.totalQty : 0,
    }));
}
