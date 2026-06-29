<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold">{{ t('part_categories_title') }}</h1>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
        @click="openAdd"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clip-rule="evenodd"
          />
        </svg>
        {{ t('add_part_category') }}
      </button>
    </div>

    <!-- Table card -->
    <div class="card mt-6 overflow-hidden">
      <!-- Search bar -->
      <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div class="relative flex-1 max-w-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clip-rule="evenodd"
            />
          </svg>
          <input
            v-model="searchQuery"
            class="input !pl-9"
            :placeholder="t('search_part_categories_placeholder')"
          />
        </div>
        <span class="text-sm text-slate-400">
          {{ filteredCategories.length }} / {{ categories.length }}
          {{ t('category') }}
        </span>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-4">{{ t('name') }}</th>
            <th class="p-4">{{ t('image') }}</th>
            <th class="p-4">{{ t('description') }}</th>
            <th class="p-4">{{ t('parameters') }}</th>
            <th class="p-4">{{ t('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredCategories.length === 0">
            <td colspan="5" class="py-12 text-center text-sm text-slate-400">
              <template v-if="searchQuery">
                {{ t('no_search_results') }}: "{{ searchQuery }}".
              </template>
              <template v-else>
                {{ t('no_categories_msg') }}
              </template>
            </td>
          </tr>
          <tr
            v-for="category in filteredCategories"
            :key="category.id"
            class="border-t border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <td class="p-4 font-semibold">{{ category.name }}</td>
            <td class="p-4">
              <img
                v-if="category.image"
                :src="category.image"
                class="h-10 w-10 rounded-md border object-cover"
              />
              <span v-else class="text-slate-300">—</span>
            </td>
            <td class="p-4 text-slate-500">
              {{ category.description || '—' }}
            </td>
            <td class="p-4">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="parameter in category.parameters"
                  :key="parameter.id"
                  class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {{ parameter.name }}
                </span>
                <span v-if="!category.parameters?.length" class="text-slate-300"
                  >—</span
                >
              </div>
            </td>
            <td class="p-4">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                  title="{{ t('edit') }}"
                  @click="openEdit(category)"
                >
                  <Pencil class="h-4 w-4" />
                </button>

                <button
                  type="button"
                  class="rounded-lg p-2 text-red-600 hover:bg-red-50"
                  title="{{ t('delete') }}"
                  @click="openDeleteConfirm(category)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="deleteError"
        class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ deleteError }}
      </div>
    </div>

    <!-- Modal -->
    <CategoryFormModal
      v-model="modalOpen"
      :category="editingCategory"
      :save-error="categorySaveError"
      :save-errors="categorySaveErrors"
      :saving="categorySaving"
      @saved="onSaved"
      @clear-error="clearCategorySaveError"
    />

    <ConfirmModal
      :visible="isDeleteConfirmVisible"
      :title="t('delete_part_category')"
      :message="`${t('confirm_delete_category_msg')}: ${categoryToDelete?.name}?`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="partCategoryStore.loading"
      @confirm="confirmDeleteCategory"
      @cancel="closeDeleteConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { usePartCategoryStore } from '../../stores/partCategoriesStore.ts';
import type {
  PartCategory,
  CreatePartCategoryPayload,
} from '../../types/partCategories.ts';
import CategoryFormModal from './PartCategoryModal.vue';
import { Pencil, Trash2 } from 'lucide-vue-next';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import { useNotificationStore } from '../../stores/notificationStore';
import {
  localizeZodIssues,
  extractZodIssues,
} from '../../utils/zodErrors.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const partCategoryStore = usePartCategoryStore();
const notificationStore = useNotificationStore();

const categories = computed(() => partCategoryStore.categories);
const deleteError = ref<string | null>(null);
const isDeleteConfirmVisible = ref(false);
const categoryToDelete = ref<PartCategory | null>(null);

const categorySaveError = ref<string | null>(null);
const categorySaveErrors = ref<string[]>([]);
const categorySaving = ref(false);

// Search
const searchQuery = ref('');
const filteredCategories = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return categories.value;
  return categories.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.parameters?.some((p) => p.name.toLowerCase().includes(q)),
  );
});

// Modal state
const modalOpen = ref(false);
const editingCategory = ref<PartCategory | null>(null);

function openAdd() {
  editingCategory.value = null;
  categorySaveError.value = null;
  modalOpen.value = true;
}

function openEdit(category: PartCategory) {
  editingCategory.value = category;
  categorySaveError.value = null;
  modalOpen.value = true;
}

async function onSaved(payload: CreatePartCategoryPayload) {
  categorySaving.value = true;
  clearCategorySaveError();

  try {
    if (editingCategory.value) {
      await partCategoryStore.updateCategory(editingCategory.value.id, payload);
      notificationStore.showToast(t('update_part_category_success'), 'success');
    } else {
      await partCategoryStore.saveCategory(payload);
      notificationStore.showToast(t('save_part_category_success'), 'success');
    }

    modalOpen.value = false;
  } catch (err: any) {
    console.error('Error saving part category:', err);

    const issues = extractZodIssues(err);
    if (issues) {
      categorySaveError.value = t('validation_failed');
      categorySaveErrors.value = localizeZodIssues(issues, t);
    } else {
      categorySaveError.value = `${t('save_part_category_error')}: ${
        err.response?.data?.message || err.response?.data?.details?.message || ''
      }`;
    }
  } finally {
    categorySaving.value = false;
    await partCategoryStore.loadCategories();
  }
}

function clearCategorySaveError() {
  categorySaveError.value = null;
  categorySaveErrors.value = [];
}

function openDeleteConfirm(category: PartCategory) {
  categoryToDelete.value = category;
  isDeleteConfirmVisible.value = true;
}

function closeDeleteConfirm() {
  isDeleteConfirmVisible.value = false;
  categoryToDelete.value = null;
}

async function confirmDeleteCategory() {
  if (!categoryToDelete.value) return;

  try {
    await partCategoryStore.deleteCategory(categoryToDelete.value.id);

    notificationStore.showToast(t('delete_part_category_success'), 'success');

    closeDeleteConfirm();
  } catch (err: any) {
    closeDeleteConfirm();

    notificationStore.showModal(
      t('delete_part_category_error_title'),
      err.response?.data?.message || t('delete_part_category_error'),
    );
  }
}

onMounted(() => partCategoryStore.loadCategories());
</script>
