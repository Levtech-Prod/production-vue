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
    />

    <!-- Main content: table + detail panel side-by-side -->
    <div class="mt-6 flex gap-4 items-start">
      <!-- Parts table card — flex-1 min-w-0 so it shrinks and lets the table
           scroll horizontally when the detail panel takes up space -->
      <div class="card flex-1 min-w-0 overflow-hidden">
        <!-- Filters + add button -->
        <div
          class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3"
        >
          <div class="relative flex-1 max-w-sm">
            <Search
              class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
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
            <Plus class="h-4 w-4" />
            {{ t('add_part') }}
          </button>
        </div>

        <!-- Dynamic parameter filters (shown when a category is selected) -->
        <PartParameterFilters
          v-if="selectedCategory && selectedCategory.parameters?.length"
          v-model="paramFilters"
          :parameters="selectedCategory.parameters"
        >
          <template #actions>
            <PartColumnPicker
              v-if="canManageColumns"
              :parameters="selectedCategory.parameters"
              @toggle="onToggleColumn"
            />
          </template>
        </PartParameterFilters>

        <PartsTable
          :parts="filteredParts"
          :column-parameters="columnParameters"
          :empty-text="tableEmptyText"
          :selected-part-id="selectedPartId"
          @click-row="onRowClick"
        >
          <template #actions="{ part }">
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
          </template>
        </PartsTable>
      </div>

      <!-- Detail panel — fixed width, slides in alongside the table.
           The table card shrinks and its inner <table> scrolls horizontally. -->
      <Transition name="panel-slide">
        <div
          v-if="selectedPart"
          class="w-[420px] shrink-0 card overflow-y-auto"
          style="max-height: calc(100vh - 7rem); position: sticky; top: 1rem;"
        >
          <PartDetailPanel
            :part="selectedPart"
            :companies="companies"
            @close="closePanel"
            @edit="openEdit"
          />
        </div>
      </Transition>
    </div>

    <!-- Part add/edit modal -->
    <PartModal
      v-model="modalOpen"
      :part="editingPart"
      :categories="categories"
      :save-error="partSaveError"
      :save-errors="partSaveErrors"
      :saving="partSaving"
      @saved="onSaved"
      @clear-error="clearPartSaveError"
    />

    <ConfirmModal
      :visible="isDeleteConfirmVisible"
      :title="t('delete_part')"
      :message="`${t('confirmations.delete_part_msg')}: ${partToDelete?.name}?`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="partsStore.loading"
      @confirm="confirmDeletePart"
      @cancel="closeDeleteConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Pencil, Trash2, Search, Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import PartModal from './PartModal.vue';
import PartDetailPanel from './PartDetailPanel.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import PartsTable from './PartsTable.vue';
import CategoryCards from './CategoryCards.vue';
import PartParameterFilters from './PartParameterFilters.vue';
import PartColumnPicker from './PartColumnPicker.vue';
import { usePartsStore } from '../../stores/partsStore.ts';
import { usePartCategoryStore } from '../../stores/partCategoriesStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useCompaniesStore } from '../../stores/companiesStore.ts';
import { localizeZodIssues, extractZodIssues } from '../../utils/zodErrors.ts';
import { translateApiError } from '../../utils/apiError.ts';
import type {
  Part,
  CreatePartPayload,
  ParameterFilters,
} from '../../types/parts.ts';
import type { PartCategoryParameter } from '../../types/partCategories.ts';

const { t, te } = useI18n();

const partsStore = usePartsStore();
const partCategoryStore = usePartCategoryStore();
const notificationStore = useNotificationStore();
const authStore = useAuthStore();
const companiesStore = useCompaniesStore();

const parts = computed(() => partsStore.parts);
const categories = computed(() => partCategoryStore.categories);
const companies = computed(() => companiesStore.companies);

const selectedCategoryId = ref(0);

const selectedCategory = computed(() =>
  categories.value.find((c) => c.id === selectedCategoryId.value),
);

// ── Parts table filters ────────────────────────────────────────────────────

const partNameSearch = ref('');
const paramFilters = ref<ParameterFilters>({});

watch(selectedCategoryId, () => {
  paramFilters.value = {};
});

function matchesParamFilters(part: Part): boolean {
  const filters = Object.entries(paramFilters.value);
  if (filters.length === 0) return true;

  const params = selectedCategory.value?.parameters || [];

  for (const [parameterIdStr, filter] of filters) {
    const parameterId = Number(parameterIdStr);
    const definition = params.find((p) => p.id === parameterId);
    if (!definition) continue;

    const entry = part.parameters?.find((v) => v.parameterId === parameterId);
    const rawValue = entry?.value ?? '';

    if (definition.type === 'number') {
      const min = filter.min?.trim();
      const max = filter.max?.trim();
      if (!min && !max) continue;

      const value = Number(rawValue);
      if (rawValue === '' || Number.isNaN(value)) return false;
      if (min !== undefined && min !== '' && value < Number(min)) return false;
      if (max !== undefined && max !== '' && value > Number(max)) return false;
    } else if (definition.type === 'dropdown' || definition.type === 'boolean') {
      const wanted = (filter.value ?? '').trim();
      if (!wanted) continue;
      if (rawValue !== wanted) return false;
    } else {
      const wanted = (filter.value ?? '').trim().toLowerCase();
      if (!wanted) continue;
      if (!rawValue.toLowerCase().includes(wanted)) return false;
    }
  }

  return true;
}

const filteredParts = computed(() => {
  const q = partNameSearch.value.trim().toLowerCase();
  return parts.value.filter((p) => {
    const matchesName =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q);
    const matchesCategory =
      !selectedCategoryId.value || p.categoryId === selectedCategoryId.value;
    return matchesName && matchesCategory && matchesParamFilters(p);
  });
});

const columnParameters = computed<PartCategoryParameter[]>(() => {
  if (!selectedCategory.value) return [];
  return (selectedCategory.value.parameters ?? []).filter(
    (param) => param.showAsColumn && param.id != null,
  );
});

const canManageColumns = computed(
  () => authStore.isAdmin && !!selectedCategory.value?.parameters?.length,
);

async function onToggleColumn(parameterId: number, showAsColumn: boolean) {
  const category = selectedCategory.value;
  const parameter = category?.parameters?.find((p) => p.id === parameterId);
  if (!category || !parameter) return;

  const previous = parameter.showAsColumn ?? false;
  parameter.showAsColumn = showAsColumn;

  try {
    await partCategoryStore.setParameterColumn(category.id, parameterId, showAsColumn);
  } catch (err) {
    parameter.showAsColumn = previous;
    notificationStore.showToast(
      translateApiError(err, { t, te }, 'errors.update_parameter_failed'),
      'error',
    );
  }
}

const tableEmptyText = computed(() =>
  partNameSearch.value || selectedCategoryId.value
    ? `${t('no_search_results')}.`
    : t('no_parts_msg'),
);

// ── Detail panel ───────────────────────────────────────────────────────────

const selectedPartId = ref<number | null>(null);

// Always derived from the store so panel updates reactively after edits
const selectedPart = computed<Part | null>(() => {
  if (selectedPartId.value == null) return null;
  return parts.value.find((p) => p.id === selectedPartId.value) ?? null;
});

function onRowClick(part: Part) {
  // Clicking the already-selected row does nothing (keeps panel open)
  if (selectedPartId.value === part.id) return;
  selectedPartId.value = part.id;
}

function closePanel() {
  selectedPartId.value = null;
}

// Close the panel if the selected part gets deleted
watch(parts, (list) => {
  if (selectedPartId.value != null && !list.find((p) => p.id === selectedPartId.value)) {
    selectedPartId.value = null;
  }
});

// ── Add / Edit modal ───────────────────────────────────────────────────────

const modalOpen = ref(false);
const editingPart = ref<Part | null>(null);
const partSaveError = ref<string | null>(null);
const partSaveErrors = ref<string[]>([]);
const partSaving = ref(false);

function openAdd() {
  editingPart.value = null;
  clearPartSaveError();
  modalOpen.value = true;
}

function openEdit(part: Part) {
  editingPart.value = part;
  clearPartSaveError();
  modalOpen.value = true;
}

async function onSaved(payload: CreatePartPayload) {
  partSaving.value = true;
  clearPartSaveError();

  try {
    if (editingPart.value) {
      await partsStore.updatePart(editingPart.value.id, payload);
      notificationStore.showToast(t('success.update_part'), 'success');
    } else {
      await partsStore.savePart(payload);
      notificationStore.showToast(t('success.save_part'), 'success');
    }

    modalOpen.value = false;
  } catch (err: any) {
    const issues = extractZodIssues(err);
    if (issues) {
      partSaveError.value = t('validation.failed');
      partSaveErrors.value = localizeZodIssues(issues, t);
    } else {
      partSaveError.value = translateApiError(err, { t, te }, 'errors.save_part_failed');
    }
  } finally {
    partSaving.value = false;
    // Reload only when adding a new part (updatePart already patches the store)
    if (!editingPart.value) {
      await partsStore.loadParts();
    }
  }
}

function clearPartSaveError() {
  partSaveError.value = null;
  partSaveErrors.value = [];
}

// ── Delete ─────────────────────────────────────────────────────────────────

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
    notificationStore.showToast(t('success.delete_part'), 'success');
    closeDeleteConfirm();
  } catch (err: any) {
    closeDeleteConfirm();
    notificationStore.showModal(
      t('errors.deletion_not_possible_title'),
      translateApiError(err, { t, te }, 'errors.delete_part_failed'),
    );
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

onMounted(() => {
  partCategoryStore.loadCategories();
  partsStore.loadParts();
  companiesStore.loadCompanies(); // cache-first — runs once per session
});
</script>

<style scoped>
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
