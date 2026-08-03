import { defineStore } from 'pinia';
import { ref } from 'vue';
import { productDocumentTypesApi, subProductDocumentTypesApi } from '../api/documentTypesAPI.ts';
import type {
  DeleteDocumentTypeResult,
  DocumentType,
  DocumentTypeFamily,
  DocumentTypePayload,
} from '../types/documentTypes.ts';

function apiFor(family: DocumentTypeFamily) {
  return family === 'product' ? productDocumentTypesApi : subProductDocumentTypesApi;
}

function bySortOrder(a: DocumentType, b: DocumentType) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * Backs the "Document types" manager modal opened from Settings > Product
 * Types (see DocumentTypesModal.vue). Holds one type's list at a time —
 * the modal shows a single product/sub-product type's document types, so
 * there's no need to cache more than that.
 */
export const useDocumentTypesStore = defineStore('documentTypes', () => {
  const items = ref<DocumentType[]>([]);
  const loading = ref(false);

  async function load(family: DocumentTypeFamily, typeId: number) {
    loading.value = true;
    try {
      const response = await apiFor(family).getAll(typeId);
      items.value = response.data;
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    items.value = [];
  }

  async function create(family: DocumentTypeFamily, typeId: number, payload: DocumentTypePayload) {
    const response = await apiFor(family).create(typeId, payload);
    items.value = [...items.value, response.data].sort(bySortOrder);
    return response.data;
  }

  async function update(family: DocumentTypeFamily, id: number, payload: DocumentTypePayload) {
    const response = await apiFor(family).update(id, payload);
    const index = items.value.findIndex((d) => d.id === id);
    if (index !== -1) items.value[index] = response.data;
    return response.data;
  }

  async function remove(family: DocumentTypeFamily, id: number): Promise<DeleteDocumentTypeResult> {
    const response = await apiFor(family).remove(id);
    items.value = items.value.filter((d) => d.id !== id);
    return response.data;
  }

  // orderedIds is the full, current-order id list (drag result); the backend
  // returns the persisted list with updated sort_order for us to adopt as-is.
  async function reorder(family: DocumentTypeFamily, typeId: number, orderedIds: number[]) {
    const response = await apiFor(family).reorder(typeId, orderedIds);
    items.value = response.data;
    return response.data;
  }

  return { items, loading, load, clear, create, update, remove, reorder };
});
