import { computed, type ComputedRef } from 'vue';
import { useStockEntriesStore } from '../stores/stockEntriesStore.ts';
import { summarizeStock, stockByCompany, type CompanyStockRow } from '../utils/stock.ts';
import type { StockEntry } from '../types/stockEntries.ts';

/**
 * Reactive stock summary for a part, derived from the cached stock entries.
 * `partId` and `fallbackPrice` are getters so the returned computeds re-run
 * when the selected part changes.
 *
 * @param partId        Getter for the current part id.
 * @param fallbackPrice Getter for the part's base price, used as the average
 *                      when there is no stock on hand.
 */
export function useStockSummary(partId: () => number, fallbackPrice: () => number) {
  const store = useStockEntriesStore();

  const entries: ComputedRef<StockEntry[]> = computed(() => store.getEntries(partId()));
  const loading = computed(() => store.isLoading(partId()));
  const summary = computed(() => summarizeStock(entries.value));

  const totalQuantity = computed(() => summary.value.totalQuantity);
  const avgPricePerPiece = computed(() => summary.value.avgPricePerPiece ?? fallbackPrice());
  const companyBreakdown = computed<CompanyStockRow[]>(() => stockByCompany(entries.value));

  return { entries, loading, totalQuantity, avgPricePerPiece, companyBreakdown };
}
