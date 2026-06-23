import { defineStore } from 'pinia';
import { ref } from 'vue';
import { partCategoriesApi } from '../api/partCategoriesAPI.ts';
import type {
  CreatePartCategoryPayload,
  PartCategory,
  UpdatePartCategoryPayload,
} from '../types/partCategories.ts';

export const usePartCategoryStore = defineStore('partCategory', () => {
  const categories = ref<PartCategory[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadCategories() {
    loading.value = true;
    error.value = null;

    try {
      const response = await partCategoriesApi.getAll();
      categories.value = response.data;
    } catch (err) {
      error.value = 'Failed to load categories';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function saveCategory(
    category: Omit<CreatePartCategoryPayload, 'id' | 'created_at'>,
  ) {
    loading.value = true;
    error.value = null;

    try {
      return await partCategoriesApi.create(category);
    } catch (err) {
      error.value = 'Failed to save category';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updateCategory(
    id: number,
    payload: UpdatePartCategoryPayload,
  ) {
    loading.value = true;
    error.value = null;

    try {
      const response = await partCategoriesApi.update(id, payload);

      const index = categories.value.findIndex(
        (category) => category.id === id,
      );

      if (index !== -1) {
        categories.value[index] = response.data;
      }

      return response.data;
    } catch (err) {
      console.error(err);
      error.value = 'Failed to update category';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    categories,
    loading,
    error,
    loadCategories,
    saveCategory,
    updateCategory,
  };
});
