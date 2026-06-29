import { defineStore } from 'pinia';
import { ref } from 'vue';
import { partsApi } from '../api/partsAPI.ts';
import type {
  CreatePartPayload,
  Part,
  UpdatePartPayload,
} from '../types/parts.ts';

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
      error.value = 'Failed to load parts';
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
      error.value = 'Failed to save part';
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
        parts.value[index] = response.data;
      }

      return response.data;
    } catch (err) {
      console.error(err);
      error.value = 'Failed to update part';
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

      error.value =
        err.response?.data?.message || 'Nem sikerült törölni az alkatrészt.';

      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    parts,
    loading,
    error,
    loadParts,
    savePart,
    updatePart,
    deletePart,
  };
});
