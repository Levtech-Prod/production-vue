import { defineStore } from 'pinia';
import { ref } from 'vue';
import { productsApi } from '../api/productsAPI.ts';
import { i18n } from '../i18n';
import type {
  ProductSummary,
  ProductDetail,
  ProductPayload,
  NewRevisionPayload,
  ProductStatus,
} from '../types/products.ts';

export const useProductsStore = defineStore('products', () => {
  const list = ref<ProductSummary[]>([]);
  const detail = ref<ProductDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchList() {
    loading.value = true;
    error.value = null;
    try {
      const response = await productsApi.getAll();
      list.value = response.data;
    } catch (err) {
      error.value = i18n.global.t('errors.load_products_failed');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchDetail(id: number) {
    loading.value = true;
    error.value = null;
    try {
      const response = await productsApi.getById(id);
      detail.value = response.data;
      return response.data;
    } catch (err) {
      error.value = i18n.global.t('errors.load_product_failed');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createProduct(payload: ProductPayload) {
    loading.value = true;
    error.value = null;
    try {
      return await productsApi.create(payload);
    } catch (err) {
      error.value = i18n.global.t('errors.save_product_failed');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updateProduct(id: number, payload: ProductPayload) {
    loading.value = true;
    error.value = null;
    try {
      const response = await productsApi.update(id, payload);
      const index = list.value.findIndex((p) => p.id === id);
      if (index !== -1) {
        list.value[index] = { ...list.value[index], ...response.data };
      }
      return response.data;
    } catch (err) {
      error.value = i18n.global.t('errors.PRODUCT_UPDATE_FAILED');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function setProductStatus(id: number, status: ProductStatus) {
    loading.value = true;
    error.value = null;
    try {
      const response = await productsApi.setStatus(id, status);
      const index = list.value.findIndex((p) => p.id === id);
      if (index !== -1) {
        list.value[index] = { ...list.value[index], ...response.data };
      }
      if (detail.value?.id === id) {
        detail.value = { ...detail.value, sku: response.data.sku, status: response.data.status };
      }
      return response.data;
    } catch (err) {
      error.value = i18n.global.t('errors.set_product_status_failed');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createRevision(id: number, payload: NewRevisionPayload) {
    loading.value = true;
    error.value = null;
    try {
      return await productsApi.createRevision(id, payload);
    } catch (err) {
      error.value = i18n.global.t('errors.save_revision_failed');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function clearDetail() {
    detail.value = null;
  }

  return {
    list,
    detail,
    loading,
    error,
    fetchList,
    fetchDetail,
    createProduct,
    updateProduct,
    setProductStatus,
    createRevision,
    clearDetail,
  };
});
