import { defineStore } from 'pinia';
import { ref } from 'vue';
import { productTypesApi, subProductTypesApi } from '../api/productTypesAPI.ts';
import type {
  ProductType,
  SubProductType,
  TypePayload,
} from '../types/productTypes.ts';

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}

/**
 * Backs the Settings > Product Types page, and also feeds the "type" select
 * in the product/sub-product create/edit modals — both read from the same
 * two lists, so this store is the single source of truth for them.
 */
export const useProductTypesStore = defineStore('productTypes', () => {
  const productTypes = ref<ProductType[]>([]);
  const subProductTypes = ref<SubProductType[]>([]);
  const loading = ref(false);

  async function loadProductTypes() {
    loading.value = true;
    try {
      const response = await productTypesApi.getAll();
      productTypes.value = response.data;
    } finally {
      loading.value = false;
    }
  }

  async function loadSubProductTypes() {
    loading.value = true;
    try {
      const response = await subProductTypesApi.getAll();
      subProductTypes.value = response.data;
    } finally {
      loading.value = false;
    }
  }

  async function loadAll() {
    await Promise.all([loadProductTypes(), loadSubProductTypes()]);
  }

  async function createProductType(payload: TypePayload) {
    const response = await productTypesApi.create(payload);
    productTypes.value = [...productTypes.value, response.data].sort(byName);
    return response.data;
  }

  async function updateProductType(id: number, payload: TypePayload) {
    const response = await productTypesApi.update(id, payload);
    const index = productTypes.value.findIndex((t) => t.id === id);
    if (index !== -1) productTypes.value[index] = response.data;
    return response.data;
  }

  async function deleteProductType(id: number) {
    await productTypesApi.delete(id);
    productTypes.value = productTypes.value.filter((t) => t.id !== id);
  }

  async function createSubProductType(payload: TypePayload) {
    const response = await subProductTypesApi.create(payload);
    subProductTypes.value = [...subProductTypes.value, response.data].sort(byName);
    return response.data;
  }

  async function updateSubProductType(id: number, payload: TypePayload) {
    const response = await subProductTypesApi.update(id, payload);
    const index = subProductTypes.value.findIndex((t) => t.id === id);
    if (index !== -1) subProductTypes.value[index] = response.data;
    return response.data;
  }

  async function deleteSubProductType(id: number) {
    await subProductTypesApi.delete(id);
    subProductTypes.value = subProductTypes.value.filter((t) => t.id !== id);
  }

  return {
    productTypes,
    subProductTypes,
    loading,
    loadProductTypes,
    loadSubProductTypes,
    loadAll,
    createProductType,
    updateProductType,
    deleteProductType,
    createSubProductType,
    updateSubProductType,
    deleteSubProductType,
  };
});
