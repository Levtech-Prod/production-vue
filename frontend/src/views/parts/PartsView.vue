<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <h1 class="text-3xl font-bold">{{ t('parts') }}</h1>
    </div>

    <!-- Categories cards section -->
    <CategoryCards
      :categories="categories"
      v-model:selectedCategoryId="selectedCategoryId"
    >
    </CategoryCards>

    <!-- Parts table card -->
    <div class="card mt-6 overflow-hidden">
      <!-- Filters + add button -->
      <div
        class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3"
      >
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
            v-model="partNameSearch"
            class="input !pl-9"
            :placeholder="t('search_parts_placeholder')"
          />
        </div>

        <select v-model.number="selectedCategoryId" class="input max-w-xs">
          <option :value="0">{{ t('all_categories') }}</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>

        <span class="text-sm text-slate-400">
          {{ filteredParts.length }} / {{ parts.length }}
        </span>

        <button
          class="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
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
          {{ t('add_part') }}
        </button>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-4">{{ t('code') }}</th>
            <th class="p-4">{{ t('name') }}</th>
            <th class="p-4">{{ t('category') }}</th>
            <th class="p-4">{{ t('price_per_piece') }}</th>
            <th class="p-4">{{ t('location') }}</th>
            <th class="p-4">{{ t('parameters') }}</th>
            <th class="p-4">{{ t('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredParts.length === 0">
            <td colspan="7" class="py-12 text-center text-sm text-slate-400">
              <template v-if="partNameSearch || selectedCategoryId">
                {{ t('no_search_results') }}.
              </template>
              <template v-else>{{ t('no_parts_msg') }}</template>
            </td>
          </tr>
          <tr
            v-for="part in filteredParts"
            :key="part.id"
            class="border-t border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <td class="p-4 font-mono text-xs text-slate-600">
              {{ part.code }}
            </td>
            <td class="p-4 font-semibold">{{ part.name }}</td>
            <td class="p-4 text-slate-500">{{ part.category.name }}</td>
            <td class="p-4">{{ part.pricePerPiece }}</td>
            <td class="p-4 text-slate-500">{{ part.location || '—' }}</td>
            <td class="p-4">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="v in part.parameters"
                  :key="v.id"
                  class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {{ v.parameter?.name }}: {{ v.value }}
                </span>
                <span v-if="!part.parameters?.length" class="text-slate-300"
                  >—</span
                >
              </div>
            </td>
            <td class="p-4">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                  :title="t('edit')"
                  @click="openEdit(part)"
                >
                  <Pencil class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="rounded-lg p-2 text-red-600 hover:bg-red-50"
                  :title="t('delete')"
                  @click="openDeleteConfirm(part)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <PartModal
      v-model="modalOpen"
      :part="editingPart"
      :categories="categories"
      :save-error="partSaveError"
      :saving="partSaving"
      @saved="onSaved"
      @clear-error="clearPartSaveError"
    />

    <ConfirmModal
      :visible="isDeleteConfirmVisible"
      :title="t('delete_part')"
      :message="`${t('confirm_delete_part_msg')}: ${partToDelete?.name}?`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="partsStore.loading"
      @confirm="confirmDeletePart"
      @cancel="closeDeleteConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Pencil, Trash2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import PartModal from './PartModal.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import CategoryCards from './CategoryCards.vue';
import { usePartsStore } from '../../stores/partsStore.ts';
import { usePartCategoryStore } from '../../stores/partCategoriesStore.ts';
import { useNotificationStore } from '../../stores/notificationStore';
import type { Part, CreatePartPayload } from '../../types/parts.ts';

const { t } = useI18n();

const partsStore = usePartsStore();
const partCategoryStore = usePartCategoryStore();
const notificationStore = useNotificationStore();

const parts = computed(() => partsStore.parts);
const categories = computed(() => partCategoryStore.categories);

const selectedCategoryId = ref(0);

// ---- Parts table filters ----
const partNameSearch = ref('');

const filteredParts = computed(() => {
  const q = partNameSearch.value.trim().toLowerCase();
  return parts.value.filter((p) => {
    const matchesName =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q);
    const matchesCategory =
      !selectedCategoryId.value || p.categoryId === selectedCategoryId.value;
    return matchesName && matchesCategory;
  });
});

// ---- Modal state ----
const modalOpen = ref(false);
const editingPart = ref<Part | null>(null);
const partSaveError = ref<string | null>(null);
const partSaving = ref(false);

function openAdd() {
  editingPart.value = null;
  partSaveError.value = null;
  modalOpen.value = true;
}

function openEdit(part: Part) {
  editingPart.value = part;
  partSaveError.value = null;
  modalOpen.value = true;
}

async function onSaved(payload: CreatePartPayload) {
  partSaving.value = true;
  partSaveError.value = null;

  try {
    if (editingPart.value) {
      await partsStore.updatePart(editingPart.value.id, payload);
      notificationStore.showToast(t('update_part_success'), 'success');
    } else {
      await partsStore.savePart(payload);
      notificationStore.showToast(t('save_part_success'), 'success');
    }

    modalOpen.value = false;
  } catch (err: any) {
    console.error('Error saving part:', err);
    partSaveError.value = `${t('save_part_error')}: ${
      err.response?.data?.message || err.response?.data?.details?.message || ''
    }`;
  } finally {
    partSaving.value = false;
    await partsStore.loadParts();
  }
}

function clearPartSaveError() {
  partSaveError.value = null;
}

// ---- Delete ----
const isDeleteConfirmVisible = ref(false);
const partToDelete = ref<Part | null>(null);

function openDeleteConfirm(part: Part) {
  partToDelete.value = part;
  isDeleteConfirmVisible.value = true;
}

function closeDeleteConfirm() {
  isDeleteConfirmVisible.value = false;
  partToDelete.value = null;
}

async function confirmDeletePart() {
  if (!partToDelete.value) return;

  try {
    await partsStore.deletePart(partToDelete.value.id);
    notificationStore.showToast(t('delete_part_success'), 'success');
    closeDeleteConfirm();
  } catch (err: any) {
    closeDeleteConfirm();
    notificationStore.showModal(
      t('delete_part_error_title'),
      err.response?.data?.message || t('delete_part_error'),
    );
  }
}

onMounted(() => {
  partCategoryStore.loadCategories();
  partsStore.loadParts();
});
</script>
