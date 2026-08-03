<template>
  <BaseModal v-model="modalOpen" :title="`${t('document_types_for')}: ${typeName}`" size="lg">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-end">
        <button
          type="button"
          class="btn-primary inline-flex items-center gap-2"
          @click="openAdd"
        >
          <Plus class="h-4 w-4" />
          {{ t('add_document_type') }}
        </button>
      </div>

      <div class="overflow-hidden rounded-lg border border-slate-200">
        <table class="w-full text-left text-sm">
          <thead class="bg-blue-50 text-xs uppercase text-slate-600">
            <tr>
              <th class="w-9 border-r border-slate-200 px-2 py-2"></th>
              <th class="border-r border-slate-200 px-3 py-2">{{ t('name') }}</th>
              <th class="border-r border-slate-200 px-3 py-2">{{ t('allowed_extensions') }}</th>
              <th class="border-r border-slate-200 px-3 py-2 text-center">{{ t('required') }}</th>
              <th class="w-24 px-3 py-2">{{ t('actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="store.loading">
              <td colspan="5" class="py-8 text-center text-sm text-slate-400">
                {{ t('loading') }}
              </td>
            </tr>
            <tr v-else-if="store.items.length === 0">
              <td colspan="5" class="py-8 text-center text-sm text-slate-400">
                {{ t('no_document_types_msg') }}
              </td>
            </tr>

            <tr
              v-for="(item, i) in store.items"
              :key="item.id"
              class="border-t border-slate-100 transition-colors"
              :class="{
                'opacity-40': dragIndex === i,
                'border-t-2 border-blue-400': dragOverIndex === i && dragIndex !== i,
              }"
              :draggable="dragEnabled"
              @dragstart="onDragStart(i, $event)"
              @dragover.prevent="onDragOver(i)"
              @drop="onDrop(i)"
              @dragend="onDragEnd"
            >
              <td class="border-r border-slate-100 px-2 py-2 text-center align-middle">
                <button
                  type="button"
                  class="inline-flex h-8 w-7 cursor-grab items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
                  :title="t('drag_to_reorder')"
                  :aria-label="t('drag_to_reorder')"
                  @mousedown="dragEnabled = true"
                  @mouseup="dragEnabled = false"
                >
                  <GripVertical class="h-4 w-4" />
                </button>
              </td>
              <td class="border-r border-slate-100 px-3 py-2">
                <div class="flex items-center gap-2">
                  <component :is="resolveIcon(item.icon)" class="h-4 w-4 shrink-0 text-slate-500" />
                  <span class="font-medium">{{ item.name }}</span>
                </div>
              </td>
              <td class="border-r border-slate-100 px-3 py-2">
                <div v-if="item.allowedExtensions.length" class="flex flex-wrap gap-1">
                  <span
                    v-for="ext in item.allowedExtensions"
                    :key="ext"
                    class="badge bg-slate-100 text-slate-600"
                  >
                    {{ ext }}
                  </span>
                </div>
                <span v-else class="text-slate-400">{{ t('any_extension') }}</span>
              </td>
              <td class="border-r border-slate-100 px-3 py-2 text-center">
                <span
                  class="badge"
                  :class="item.required ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'"
                >
                  {{ item.required ? t('required') : t('optional') }}
                </span>
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                    :title="t('edit')"
                    @click="openEdit(item)"
                  >
                    <Pencil class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="rounded-lg p-2 text-red-600 hover:bg-red-50"
                    :title="t('delete')"
                    @click="openDeleteConfirm(item)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </BaseModal>

  <DocumentTypeFormModal
    v-model="formOpen"
    :title="editing ? t('edit_document_type') : t('add_document_type')"
    :initial="editing"
    :save-error="saveError"
    :saving="saving"
    @saved="onSaved"
  />

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
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import BaseModal from '../../components/modal/BaseModal.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import DocumentTypeFormModal from './DocumentTypeFormModal.vue';
import { useDocumentTypesStore } from '../../stores/documentTypesStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { useConfirmDelete } from '../../composables/useConfirmDelete.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { extractZodIssues, localizeZodIssues } from '../../utils/zodErrors.ts';
import { resolveIcon } from '../../utils/documentTypeIcons.ts';
import type { DocumentType, DocumentTypeFamily, DocumentTypePayload } from '../../types/documentTypes.ts';

const props = defineProps<{
  family: DocumentTypeFamily;
  typeId: number;
  typeName: string;
}>();

const modalOpen = defineModel<boolean>({ default: false });

const { t, te } = useI18n();
const store = useDocumentTypesStore();
const notificationStore = useNotificationStore();

watch(modalOpen, (isOpen) => {
  if (isOpen) {
    store.load(props.family, props.typeId);
  } else {
    store.clear();
  }
});

// ── Add / edit ──────────────────────────────────────────────────────────
const formOpen = ref(false);
const editing = ref<DocumentTypePayload | null>(null);
const editingId = ref<number | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);

function openAdd() {
  editing.value = null;
  editingId.value = null;
  saveError.value = null;
  formOpen.value = true;
}

function openEdit(item: DocumentType) {
  editing.value = {
    name: item.name,
    icon: item.icon,
    allowedExtensions: item.allowedExtensions,
    required: item.required,
  };
  editingId.value = item.id;
  saveError.value = null;
  formOpen.value = true;
}

async function onSaved(payload: DocumentTypePayload) {
  saving.value = true;
  saveError.value = null;

  try {
    if (editingId.value != null) {
      await store.update(props.family, editingId.value, payload);
      notificationStore.showToast(t('success.update_document_type'), 'success');
    } else {
      await store.create(props.family, props.typeId, payload);
      notificationStore.showToast(t('success.save_document_type'), 'success');
    }
    formOpen.value = false;
  } catch (err: any) {
    const issues = extractZodIssues(err);
    if (issues) {
      saveError.value = localizeZodIssues(issues, t).join(' ');
    } else {
      saveError.value = translateApiError(err, { t, te }, 'errors.save_document_type_failed');
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
    const result = await store.remove(props.family, target.id);
    const message =
      result.filesMovedToOther > 0
        ? t('success.delete_document_type_with_files', { count: result.filesMovedToOther })
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
// and surfaces an error toast if the backend call fails. ──
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

  const list = store.items;
  const [moved] = list.splice(from, 1);
  list.splice(targetIndex, 0, moved);

  try {
    await store.reorder(
      props.family,
      props.typeId,
      list.map((d) => d.id),
    );
  } catch (err: any) {
    await store.load(props.family, props.typeId);
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
