import { defineStore } from 'pinia';
import { ref } from 'vue';
import { stockEntriesApi } from '../api/stockEntriesAPI.ts';
import type { StockEntry, CreateStockEntryPayload } from '../types/stockEntries.ts';

export const useStockEntriesStore = defineStore('stockEntries', () => {
  // Cache: partId → entries (newest-first). An absent key means "not yet loaded".
  const entriesByPartId = ref<Record<number, StockEntry[]>>({});
  const loadingPartId = ref<number | null>(null);
  const savingEntry = ref(false);

  function getEntries(partId: number): StockEntry[] {
    return entriesByPartId.value[partId] ?? [];
  }

  function isCached(partId: number): boolean {
    return Object.prototype.hasOwnProperty.call(entriesByPartId.value, partId);
  }

  function isLoading(partId: number): boolean {
    return loadingPartId.value === partId;
  }

  async function loadEntries(partId: number): Promise<void> {
    if (isCached(partId)) return; // already loaded — no extra API call
    loadingPartId.value = partId;
    try {
      const res = await stockEntriesApi.getByPartId(partId);
      entriesByPartId.value = { ...entriesByPartId.value, [partId]: res.data };
    } finally {
      loadingPartId.value = null;
    }
  }

  async function addEntry(payload: CreateStockEntryPayload): Promise<StockEntry> {
    savingEntry.value = true;
    try {
      const res = await stockEntriesApi.create(payload);
      const newEntry = res.data;
      // Prepend to cache (newest first); initialise if not yet cached
      const existing = entriesByPartId.value[payload.partId] ?? [];
      entriesByPartId.value = {
        ...entriesByPartId.value,
        [payload.partId]: [newEntry, ...existing],
      };
      return newEntry;
    } finally {
      savingEntry.value = false;
    }
  }

  /**
   * Drop the cache for a part and immediately re-fetch.
   * Used after a stock removal so quantityConsumed values are refreshed.
   */
  async function invalidateAndReload(partId: number): Promise<void> {
    const updated = { ...entriesByPartId.value };
    delete updated[partId];
    entriesByPartId.value = updated;
    await loadEntries(partId);
  }

  return {
    entriesByPartId,
    loadingPartId,
    savingEntry,
    getEntries,
    isCached,
    isLoading,
    loadEntries,
    addEntry,
    invalidateAndReload,
  };
});
