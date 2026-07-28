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
      const { entry, affectedReceived } = (await stockEntriesApi.create(payload)).data;

      // Patch any received rows drawn down by a FIFO removal (fresh
      // quantityConsumed), then prepend the new entry (newest first).
      const patched = new Map(affectedReceived.map((e) => [e.id, e]));
      const existing = entriesByPartId.value[payload.partId] ?? [];
      entriesByPartId.value = {
        ...entriesByPartId.value,
        [payload.partId]: [entry, ...existing.map((e) => patched.get(e.id) ?? e)],
      };
      return entry;
    } finally {
      savingEntry.value = false;
    }
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
  };
});
