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
        <Plus class="h-4 w-4" />
        {{ t('add_part_category') }}
      </button>
    </div>

    <!-- Table card -->
    <div class="card mt-6 overflow-hidden">
      <!-- Search bar -->
      <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div class="relative flex-1 max-w-sm">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
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
        <thead class="table-head text-xs">
          <tr>
            <th class="w-8 px-3 py-2"></th>
            <th class="px-3 py-2">{{ t('name') }}</th>
            <th class="px-3 py-2">{{ t('image') }}</th>
            <th class="px-3 py-2">{{ t('description') }}</th>
            <th class="px-3 py-2 text-right">{{ t('actions') }}</th>
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
          <template v-for="category in filteredCategories" :key="category.id">
            <!-- Category row (click to expand the parameters section) -->
            <tr
              class="cursor-pointer border-t border-slate-200 transition-colors"
              :class="
                isExpanded(category.id)
                  ? 'bg-blue-50 hover:bg-blue-100'
                  : 'even:bg-slate-50 hover:bg-slate-200'
              "
              @click="toggleExpand(category)"
            >
              <td class="px-3 py-2">
                <ClipboardList
                  class="h-4 w-4 transition-colors"
                  :class="isExpanded(category.id) ? 'text-blue-600' : 'text-slate-400'"
                />
              </td>
              <td class="px-3 py-2 font-semibold">{{ category.name }}</td>
              <td class="px-3 py-2">
                <button
                  v-if="category.image"
                  type="button"
                  class="block"
                  :title="t('view_image')"
                  @click.stop="openImagePreview(category)"
                >
                  <img
                    :src="category.image"
                    class="h-8 w-8 rounded-md border object-cover transition-transform hover:scale-105"
                    :alt="category.name"
                  />
                </button>
                <span v-else class="text-slate-300">—</span>
              </td>
              <td class="px-3 py-2 text-slate-500">
                {{ category.description || '—' }}
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                    :title="t('change_log')"
                    @click.stop="openHistory(category)"
                  >
                    <Clock class="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    class="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                    :title="t('edit')"
                    @click.stop="openEdit(category)"
                  >
                    <Pencil class="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    class="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                    :title="t('delete')"
                    @click.stop="openDeleteConfirm(category)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>

            <!-- Expanded parameters section -->
            <tr v-if="isExpanded(category.id)" class="bg-white">
              <td class="border-b border-slate-200 p-0"></td>
              <td colspan="4" class="border-b border-slate-200 px-3 pb-3">
                <PartCategoryParameterList
                  :ref="paramListRefFor(category.id)"
                  v-model="editStates[category.id].params"
                />

                <div
                  v-if="editStates[category.id].error || editStates[category.id].errors.length"
                  class="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  <p
                    v-if="editStates[category.id].error"
                    :class="{ 'mb-1 font-medium': editStates[category.id].errors.length }"
                  >
                    {{ editStates[category.id].error }}
                  </p>
                  <ul
                    v-if="editStates[category.id].errors.length"
                    class="list-disc space-y-0.5 pl-5"
                  >
                    <li
                      v-for="(msg, i) in editStates[category.id].errors"
                      :key="i"
                    >
                      {{ msg }}
                    </li>
                  </ul>
                </div>

                <div class="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-60"
                    :disabled="!rowDirty(category.id)"
                    @click="resetParams(category.id)"
                  >
                    {{ t('cancel') }}
                  </button>
                  <button
                    type="button"
                    class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60"
                    :disabled="editStates[category.id].saving || !rowDirty(category.id)"
                    @click="saveParams(category)"
                  >
                    {{ editStates[category.id].saving ? t('saving') : t('save') }}
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
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
      :visible="pendingRename !== null"
      :title="t('regenerate_part_names')"
      :message="t('confirmations.regenerate_part_names_msg')"
      :confirm-text="t('confirm')"
      :cancel-text="t('cancel')"
      :loading="renameBusy"
      @confirm="confirmRename"
      @cancel="cancelRename"
    />

    <ConfirmModal
      :visible="isDeleteConfirmVisible"
      :title="t('delete_part_category')"
      :message="`${t('confirmations.delete_category_msg')}: ${categoryToDelete?.name}?`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="partCategoryStore.loading"
      @confirm="confirmDeleteCategory"
      @cancel="closeDeleteConfirm"
    />

    <!-- Image lightbox -->
    <ImagePreviewModal
      v-model="imagePreviewOpen"
      :image="previewCategory?.image"
      :title="previewCategory?.name"
    />

    <!-- Change log -->
    <ChangeLogModal
      v-if="historyCategory"
      v-model="historyOpen"
      entity-type="part_category"
      :entity-id="historyCategory.id"
      :title="historyCategory.name"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, nextTick } from 'vue';
import { usePartCategoryStore } from '../../stores/partCategoriesStore.ts';
import type {
  PartCategory,
  PartCategoryParameter,
  CreatePartCategoryPayload,
} from '../../types/partCategories.ts';
import CategoryFormModal from './PartCategoryModal.vue';
import PartCategoryParameterList from './PartCategoryParamsList.vue';
import ChangeLogModal from '../../components/ChangeLogModal.vue';
import { Pencil, Trash2, Plus, Search, ClipboardList, Clock } from 'lucide-vue-next';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import ImagePreviewModal from '../../components/modal/ImagePreviewModal.vue';
import { useNotificationStore } from '../../stores/notificationStore';
import { useConfirmDelete } from '../../composables/useConfirmDelete.ts';
import {
  localizeZodIssues,
  extractZodIssues,
} from '../../utils/zodErrors.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { useI18n } from 'vue-i18n';

const { t, te } = useI18n();

const partCategoryStore = usePartCategoryStore();
const notificationStore = useNotificationStore();

const categories = computed(() => partCategoryStore.categories);
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

// Image lightbox
const imagePreviewOpen = ref(false);
const previewCategory = ref<PartCategory | null>(null);

function openImagePreview(category: PartCategory) {
  previewCategory.value = category;
  imagePreviewOpen.value = true;
}

// Change log
const historyOpen = ref(false);
const historyCategory = ref<PartCategory | null>(null);

function openHistory(category: PartCategory) {
  historyCategory.value = category;
  historyOpen.value = true;
}

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

// Generic confirm-then-run (the composable is already used for non-delete
// flows, e.g. replacing a document): every action that rebuilds part names in
// bulk routes through this one dialog.
const {
  target: pendingRename,
  busy: renameBusy,
  open: askRenameConfirm,
  cancel: cancelRename,
  confirm: confirmRename,
} = useConfirmDelete<{ run: () => Promise<void> }>(async ({ run }) => {
  await run();
  return true;
});

/**
 * Whether saving `payload` rewrites the names of this category's existing
 * parts. Switching *to* Custom doesn't — the backend deliberately leaves those
 * names alone rather than collapsing them to a prefix.
 */
function renamesParts(payload: CreatePartCategoryPayload): boolean {
  const current = editingCategory.value;
  if (!current || payload.partNameMode !== 'parameters') return false;
  return payload.name !== current.name || current.partNameMode !== 'parameters';
}

async function onSaved(payload: CreatePartCategoryPayload) {
  if (renamesParts(payload)) {
    askRenameConfirm({ run: () => persistCategory(payload) });
    return;
  }
  await persistCategory(payload);
}

async function persistCategory(payload: CreatePartCategoryPayload) {
  categorySaving.value = true;
  clearCategorySaveError();

  try {
    if (editingCategory.value) {
      await partCategoryStore.updateCategory(editingCategory.value.id, payload);
      notificationStore.showToast(t('success.update_part_category'), 'success');
    } else {
      await partCategoryStore.saveCategory(payload);
      notificationStore.showToast(t('success.save_part_category'), 'success');
    }

    modalOpen.value = false;
  } catch (err: unknown) {
    console.error('Error saving part category:', err);

    const issues = extractZodIssues(err);
    if (issues) {
      categorySaveError.value = t('validation.failed');
      categorySaveErrors.value = localizeZodIssues(issues, t);
    } else {
      categorySaveError.value = translateApiError(
        err,
        { t, te },
        'errors.save_part_category_failed',
      );
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
    const deletedId = categoryToDelete.value.id;
    await partCategoryStore.deleteCategory(deletedId);
    collapse(deletedId);

    notificationStore.showToast(t('success.delete_part_category'), 'success');

    closeDeleteConfirm();
  } catch (err: unknown) {
    closeDeleteConfirm();

    notificationStore.showModal(
      t('errors.deletion_not_possible_title'),
      translateApiError(err, { t, te }, 'errors.delete_part_category_failed'),
    );
  }
}

// --- Inline parameter editing (expandable rows, multiple open at once) ---
interface RowEditState {
  params: PartCategoryParameter[];
  // Snapshot of the parameters when the row was opened, to detect changes.
  snapshot: string;
  saving: boolean;
  error: string | null;
  errors: string[];
}

// Edit buffers, keyed by category id. A buffer outlives collapse so that
// closing a row never silently discards unsaved edits — it's cleared only on
// an explicit reset (Cancel) via snapshot, or on delete via collapse().
const editStates = ref<Record<number, RowEditState>>({});
// Which rows are currently open. Separate from editStates so a collapsed row
// can keep its in-progress buffer for when it's reopened.
const expandedIds = ref<Set<number>>(new Set());
// Per-row editor instances (for validation). Not reactive — methods only.
const paramListRefs = new Map<
  number,
  InstanceType<typeof PartCategoryParameterList>
>();

function isExpanded(id: number): boolean {
  return expandedIds.value.has(id);
}

// The editors live inside a v-for; a keyed function ref keeps one instance per
// open row rather than collecting them all into a single array ref.
function setParamListRef(id: number, el: unknown) {
  if (el) {
    paramListRefs.set(
      id,
      el as InstanceType<typeof PartCategoryParameterList>,
    );
  } else {
    paramListRefs.delete(id);
  }
}

// One stable ref callback per row, so Vue doesn't detach/reattach the ref on
// every re-render (which a fresh inline arrow in the template would cause).
const paramListRefSetters = new Map<number, (el: unknown) => void>();
function paramListRefFor(id: number): (el: unknown) => void {
  let setter = paramListRefSetters.get(id);
  if (!setter) {
    setter = (el: unknown) => setParamListRef(id, el);
    paramListRefSetters.set(id, setter);
  }
  return setter;
}

// Fresh, editable copy of a category's parameters (decoupled from the store).
function cloneParameters(
  parameters?: PartCategoryParameter[],
): PartCategoryParameter[] {
  return (parameters ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    unit: p.unit ?? '',
    required: p.required,
    showAsColumn: p.showAsColumn ?? false,
    options: p.options ? [...p.options] : [],
  }));
}

// Cached dirty state per open row, recomputed only when a buffer or its
// snapshot actually changes — not on every render or unrelated update.
const dirtyRows = computed<Record<number, boolean>>(() => {
  const result: Record<number, boolean> = {};
  for (const id of expandedIds.value) {
    const state = editStates.value[id];
    if (state) {
      result[id] = JSON.stringify(state.params) !== state.snapshot;
    }
  }
  return result;
});

function rowDirty(id: number): boolean {
  return dirtyRows.value[id] ?? false;
}

// Full teardown: close the row and drop its buffer entirely (used when the
// category itself is removed).
function collapse(id: number) {
  expandedIds.value.delete(id);
  delete editStates.value[id];
  paramListRefs.delete(id);
  paramListRefSetters.delete(id);
}

// Revert edits back to the last-saved snapshot without closing the section.
function resetParams(id: number) {
  const state = editStates.value[id];
  if (!state) return;

  state.params = JSON.parse(state.snapshot) as PartCategoryParameter[];
  state.error = null;
  state.errors = [];
  nextTick(() => paramListRefs.get(id)?.resetValidation());
}

function toggleExpand(category: PartCategory) {
  if (isExpanded(category.id)) {
    // Collapse only — keep the buffer so unsaved edits survive a reopen.
    expandedIds.value.delete(category.id);
    return;
  }

  // Reuse an existing buffer (e.g. after a collapse) or seed a fresh one.
  if (!editStates.value[category.id]) {
    const params = cloneParameters(category.parameters);
    editStates.value[category.id] = {
      params,
      snapshot: JSON.stringify(params),
      saving: false,
      error: null,
      errors: [],
    };
  }
  expandedIds.value.add(category.id);
  nextTick(() => paramListRefs.get(category.id)?.resetValidation());
}

// What a generated part name draws from: which parameters are columns, their
// order, and — for booleans, which contribute their own name — the name itself.
function columnSignature(parameters: PartCategoryParameter[]): string {
  return parameters
    .filter((p) => p.showAsColumn)
    .map((p) => `${p.id ?? 'new'}:${p.type}:${p.name}`)
    .join('|');
}

async function saveParams(category: PartCategory) {
  const state = editStates.value[category.id];
  if (!state) return;

  state.error = null;
  state.errors = [];

  if (!(paramListRefs.get(category.id)?.validate() ?? true)) return;

  const savedParams = JSON.parse(state.snapshot) as PartCategoryParameter[];
  if (
    category.partNameMode === 'parameters' &&
    columnSignature(state.params) !== columnSignature(savedParams)
  ) {
    askRenameConfirm({ run: () => persistParams(category, state) });
    return;
  }

  await persistParams(category, state);
}

async function persistParams(category: PartCategory, state: RowEditState) {
  state.saving = true;

  try {
    const updated = await partCategoryStore.updateCategory(category.id, {
      name: category.name,
      description: category.description,
      image: category.image ?? null,
      partNameMode: category.partNameMode,
      parameters: state.params
        .filter((p) => p.name.trim() !== '')
        .map((p) => ({
          ...p,
          options:
            p.type === 'dropdown'
              ? (p.options || []).filter((option) => option.trim() !== '')
              : [],
        })),
    });

    notificationStore.showToast(t('success.update_part_category'), 'success');

    // Re-sync the buffer with the saved rows so new parameters pick up their ids.
    state.params = cloneParameters(updated.parameters);
    state.snapshot = JSON.stringify(state.params);
  } catch (err: unknown) {
    console.error('Error saving category parameters:', err);

    const issues = extractZodIssues(err);
    if (issues) {
      state.error = t('validation.failed');
      state.errors = localizeZodIssues(issues, t);
    } else {
      state.error = translateApiError(
        err,
        { t, te },
        'errors.save_part_category_failed',
      );
    }
  } finally {
    state.saving = false;
  }
}

onMounted(() => partCategoryStore.loadCategories());
</script>
