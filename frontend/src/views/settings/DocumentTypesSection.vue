<!-- Inline "document types" manager rendered inside a type row's expanded
     section (see TypeManagerSection.vue's #expanded slot) — mirrors how
     PartCategoryParamsList.vue sits inside PartCategoriesView's expanded
     rows. One instance per expanded row, with its own local state, so
     several rows can be open at once without stepping on each other.

     Add/edit happens inline in the table (DocumentTypeRowForm.vue) rather
     than in a separate modal — only one row (new or existing) is editable
     at a time; each Save persists that single row immediately (the backend
     is per-row CRUD, not a batch endpoint), matching this app's existing
     "no unsaved changes to lose" simplicity rather than part categories'
     whole-list batch save (which needs a batch endpoint this API doesn't
     have). -->
<template>
  <div class="flex flex-col gap-3 mt-2">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {{ t('manage_document_types') }}
      </h3>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="draft !== null"
        @click="startAdd"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('add_document_type') }}
      </button>
    </div>

    <div
      v-if="saveError"
      class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
    >
      {{ saveError }}
    </div>

    <div class="overflow-visible rounded-lg border border-slate-300 bg-white">
      <table class="w-full text-left text-sm">
        <thead
          class="border-b border-slate-300 bg-blue-50 text-[11px] uppercase tracking-wide text-slate-600"
        >
          <tr>
            <th
              class="w-9 rounded-tl-lg border-r border-slate-300 px-2 py-1"
            ></th>
            <th class="border-r border-slate-300 px-2 py-1 font-medium">
              {{ t('name') }}
            </th>
            <th class="border-r border-slate-300 px-2 py-1 font-medium">
              {{ t('allowed_extensions') }}
            </th>
            <th
              class="border-r border-slate-300 px-2 py-1 text-center font-medium"
            >
              {{ t('required') }}
            </th>
            <th class="w-20 rounded-tr-lg px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td
              colspan="5"
              class="px-2 py-4 text-center text-sm text-slate-400"
            >
              {{ t('loading') }}
            </td>
          </tr>
          <tr v-else-if="items.length === 0 && draft === null">
            <td
              colspan="5"
              class="px-2 py-4 text-center text-sm text-slate-400"
            >
              {{ t('no_document_types_msg') }}
            </td>
          </tr>

          <tr
            v-for="(item, i) in items"
            :key="item.id"
            class="border-t border-slate-300 align-top transition-colors"
            :class="{
              'opacity-40': dragIndex === i,
              'border-t-2 border-blue-400':
                dragOverIndex === i && dragIndex !== i,
            }"
            :draggable="dragEnabled && draft === null"
            @dragstart="onDragStart(i, $event)"
            @dragover.prevent="onDragOver(i)"
            @drop="onDrop(i)"
            @dragend="onDragEnd"
          >
            <td
              class="border-r border-slate-300 px-1 py-1 text-center align-middle"
            >
              <button
                type="button"
                class="inline-flex h-8 w-7 cursor-grab items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="draft !== null"
                :title="t('drag_to_reorder')"
                :aria-label="t('drag_to_reorder')"
                @mousedown="dragEnabled = true"
                @mouseup="dragEnabled = false"
              >
                <GripVertical class="h-4 w-4" />
              </button>
            </td>

            <DocumentTypeRowForm
              v-if="draft && draft.id === item.id"
              v-model="draft"
              :saving="saving"
              :name-error="nameError"
              @save="saveDraft"
              @cancel="cancelDraft"
            />
            <template v-else>
              <td class="border-r border-slate-300 px-2 py-1">
                <div class="flex items-center gap-2">
                  <component
                    :is="resolveIcon(item.icon)"
                    class="h-4 w-4 shrink-0 text-slate-500"
                  />
                  <span class="font-medium">{{ item.name }}</span>
                </div>
              </td>
              <td class="border-r border-slate-300 px-2 py-1">
                <div
                  v-if="item.allowedExtensions.length"
                  class="flex flex-wrap gap-1"
                >
                  <span
                    v-for="ext in item.allowedExtensions"
                    :key="ext"
                    class="badge bg-slate-100 text-slate-600"
                  >
                    {{ ext }}
                  </span>
                </div>
                <span v-else class="text-slate-400">{{
                  t('any_extension')
                }}</span>
              </td>
              <td class="border-r border-slate-300 px-2 py-1 text-center">
                <span
                  class="badge"
                  :class="
                    item.required
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-500'
                  "
                >
                  {{ item.required ? t('required') : t('optional') }}
                </span>
              </td>
              <td class="px-2 py-1">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="draft !== null"
                    :title="t('edit')"
                    @click="startEdit(item)"
                  >
                    <Pencil class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="draft !== null"
                    :title="t('delete')"
                    @click="openDeleteConfirm(item)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </template>
          </tr>

          <!-- New, unsaved row — appended at the end while adding. -->
          <tr
            v-if="draft && draft.id === null"
            class="border-t border-slate-300 bg-blue-50/40 align-top"
          >
            <td class="border-r border-slate-300 px-1 py-1"></td>
            <DocumentTypeRowForm
              v-model="draft"
              :saving="saving"
              :name-error="nameError"
              @save="saveDraft"
              @cancel="cancelDraft"
            />
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <ConfirmModal
    :visible="deleteTarget != null"
    :title="t('delete_document_type')"
    :message="`${t('confirmations.delete_document_type_msg')}: ${deleteTarget?.name}?`"
    :confirm-text="t('delete')"
    :cancel-text="t('cancel')"
    :loading="deleteBusy"
    @confirm="confirmDeleteDocumentType"
    @cancel="cancelDeleteDocumentType"
  />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import DocumentTypeRowForm from './DocumentTypeRowForm.vue';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { useConfirmDelete } from '../../composables/useConfirmDelete.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { extractZodIssues, localizeZodIssues } from '../../utils/zodErrors.ts';
import { resolveIcon } from '../../utils/documentTypeIcons.ts';
import {
  documentTypeDraftFrom,
  documentTypeNameError,
  documentTypePayloadFrom,
  emptyDocumentTypeDraft,
} from '../../utils/documentTypeDraft.ts';
import { documentTypesApiFor } from '../../api/documentTypesAPI.ts';
import type {
  DocumentType,
  DocumentTypeDraft,
  DocumentTypeFamily,
} from '../../types/documentTypes.ts';

const props = defineProps<{
  family: DocumentTypeFamily;
  typeId: number;
}>();

const { t, te } = useI18n();
const notificationStore = useNotificationStore();
const api = documentTypesApiFor(props.family);

function bySortOrder(a: DocumentType, b: DocumentType) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

const items = ref<DocumentType[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const response = await api.getAll(props.typeId);
    items.value = response.data;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ── Inline add / edit — one row editable at a time ──────────────────────

const draft = ref<DocumentTypeDraft | null>(null);
const nameError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);

function startAdd() {
  draft.value = emptyDocumentTypeDraft();
  nameError.value = null;
  saveError.value = null;
}

function startEdit(item: DocumentType) {
  draft.value = documentTypeDraftFrom(item);
  nameError.value = null;
  saveError.value = null;
}

function cancelDraft() {
  draft.value = null;
  nameError.value = null;
  saveError.value = null;
}

async function saveDraft() {
  if (!draft.value) return;

  nameError.value = documentTypeNameError(draft.value, t);
  if (nameError.value) return;
  saveError.value = null;

  const payload = documentTypePayloadFrom(draft.value);

  saving.value = true;
  try {
    if (draft.value.id != null) {
      const response = await api.update(draft.value.id, payload);
      const index = items.value.findIndex((d) => d.id === draft.value!.id);
      if (index !== -1) items.value[index] = response.data;
      notificationStore.showToast(t('success.update_document_type'), 'success');
    } else {
      const response = await api.create(props.typeId, payload);
      items.value = [...items.value, response.data].sort(bySortOrder);
      notificationStore.showToast(t('success.save_document_type'), 'success');
    }
    draft.value = null;
  } catch (err: any) {
    const issues = extractZodIssues(err);
    if (issues) {
      saveError.value = localizeZodIssues(issues, t).join(' ');
    } else {
      saveError.value = translateApiError(
        err,
        { t, te },
        'errors.save_document_type_failed',
      );
    }
  } finally {
    saving.value = false;
  }
}

// ── Delete (with confirmation — files move to "Other documents", never deleted) ──
const {
  target: deleteTarget,
  busy: deleteBusy,
  open: openDeleteTarget,
  confirm: confirmDeleteDocumentType,
  cancel: cancelDeleteDocumentType,
} = useConfirmDelete<DocumentType>(async (target) => {
  try {
    const response = await api.remove(target.id);
    items.value = items.value.filter((d) => d.id !== target.id);
    const result = response.data;
    const message =
      result.filesMovedToOther > 0
        ? t('success.delete_document_type_with_files', {
            count: result.filesMovedToOther,
          })
        : t('success.delete_document_type');
    notificationStore.showToast(message, 'success');
    return true;
  } catch (err: any) {
    notificationStore.showModal(
      t('errors.deletion_not_possible_title'),
      translateApiError(err, { t, te }, 'errors.delete_document_type_failed'),
    );
    return false;
  }
});

function openDeleteConfirm(item: DocumentType) {
  openDeleteTarget(item);
}

// ── Drag-to-reorder — persists immediately on drop; reverts (via reload)
// and surfaces an error toast if the backend call fails. Disabled while a
// row is being added/edited (see :draggable / :disabled above). ──
const dragEnabled = ref(false);
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index)); // Firefox needs data set
  }
}

function onDragOver(index: number) {
  dragOverIndex.value = index;
}

async function onDrop(targetIndex: number) {
  const from = dragIndex.value;
  dragOverIndex.value = null;
  if (from === null || from === targetIndex) return;

  const list = items.value;
  const [moved] = list.splice(from, 1);
  list.splice(targetIndex, 0, moved);

  try {
    const response = await api.reorder(
      props.typeId,
      list.map((d) => d.id),
    );
    items.value = response.data;
  } catch (err: any) {
    await load();
    notificationStore.showToast(
      translateApiError(err, { t, te }, 'errors.reorder_document_types_failed'),
      'error',
    );
  }
}

function onDragEnd() {
  dragEnabled.value = false;
  dragIndex.value = null;
  dragOverIndex.value = null;
}
</script>
