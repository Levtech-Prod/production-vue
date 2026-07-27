import { defineStore } from 'pinia';
import { ref } from 'vue';
import { partsApi } from '../api/partsAPI.ts';
import { i18n } from '../i18n';
import { translateApiError } from '../utils/apiError.ts';
import type {
  CreatePartPayload,
  Part,
  UpdatePartPayload,
} from '../types/parts.ts';
import type { StockEntry } from '../types/stockEntries.ts';

export const usePartsStore = defineStore('parts', () => {
  const parts = ref<Part[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadParts() {
    loading.value = true;
    error.value = null;

    try {
      const response = await partsApi.getAll();
      parts.value = response.data;
    } catch (err) {
      error.value = i18n.global.t('errors.load_parts_failed');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function savePart(payload: CreatePartPayload) {
    loading.value = true;
    error.value = null;

    try {
      return await partsApi.create(payload);
    } catch (err) {
      error.value = i18n.global.t('errors.save_part_failed');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updatePart(id: number, payload: UpdatePartPayload) {
    loading.value = true;
    error.value = null;

    try {
      const response = await partsApi.update(id, payload);

      const index = parts.value.findIndex((part) => part.id === id);

      if (index !== -1) {
        // Preserve stock summary fields — the PUT response doesn't compute them
        parts.value[index] = {
          ...response.data,
          totalQuantity: parts.value[index].totalQuantity,
          avgPricePerPiece: parts.value[index].avgPricePerPiece,
        };
      }

      return response.data;
    } catch (err) {
      console.error(err);
      error.value = i18n.global.t('errors.PART_UPDATE_FAILED');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deletePart(id: number) {
    loading.value = true;
    error.value = null;

    try {
      await partsApi.delete(id);

      parts.value = parts.value.filter((part) => part.id !== id);
    } catch (err: any) {
      console.error(err);

      error.value = translateApiError(
        err,
        { t: i18n.global.t, te: i18n.global.te },
        'errors.delete_part_failed',
      );

      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Recompute totalQuantity and avgPricePerPiece for one part from the
   * already-cached stock entries. Called after adding an entry so we don't
   * need to re-fetch the full parts list.
   */
  function updatePartStockSummary(partId: number, entries: StockEntry[]) {
    const index = parts.value.findIndex((p) => p.id === partId);
    if (index === -1) return;

    const totalQty = entries.reduce((sum, e) => sum + Number(e.quantity), 0);
    const totalValue = entries.reduce(
      (sum, e) => sum + Number(e.pricePerPiece) * Number(e.quantity),
      0,
    );

    parts.value[index] = {
      ...parts.value[index],
      totalQuantity: totalQty,
      avgPricePerPiece:
        totalQty > 0
          ? totalValue / totalQty
          : Number(parts.value[index].pricePerPiece),
    };
  }

  return {
    parts,
    loading,
    error,
    loadParts,
    savePart,
    updatePart,
    deletePart,
    updatePartStockSummary,
  };
});
