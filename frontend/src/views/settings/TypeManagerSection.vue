<template>
  <div class="card overflow-hidden">
    <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <h2 class="text-lg font-semibold text-slate-800">{{ title }}</h2>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
        @click="openAdd"
      >
        <Plus class="h-4 w-4" />
        {{ addLabel }}
      </button>
    </div>

    <table class="w-full text-left text-sm">
      <thead class="bg-blue-50 text-xs uppercase text-black">
        <tr>
          <th class="p-4">{{ t('name') }}</th>
          <th class="p-4">{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="items.length === 0">
          <td colspan="2" class="py-10 text-center text-sm text-slate-400">
            {{ loading ? t('loading') : emptyMessage }}
          </td>
        </tr>
        <tr
          v-for="item in items"
          :key="item.id"
          class="border-t border-slate-100 even:bg-slate-50 hover:bg-slate-200 transition-colors"
        >
          <td class="p-4 font-medium">{{ item.name }}</td>
          <td class="p-4">
            <div class="flex items-center gap-2">
              <button
                v-if="onManageDocuments"
                type="button"
                class="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                :title="manageDocumentsLabel"
                @click="onManageDocuments(item)"
              >
                <Files class="h-4 w-4" />
              </button>
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

  <TypeFormModal
    v-model="modalOpen"
    :title="editing ? editTitle : addLabel"
    :initial-name="editing?.name"
    :save-error="saveError"
    :saving="saving"
    @saved="onSaved"
  />

  <ConfirmModal
    :visible="isDeleteConfirmVisible"
    :title="deleteTitle"
    :message="`${deleteMessagePrefix}: ${itemToDelete?.name}?`"
    :confirm-text="t('delete')"
    :cancel-text="t('cancel')"
    :loading="deleting"
    @confirm="confirmDelete"
    @cancel="closeDeleteConfirm"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Files, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import TypeFormModal from './TypeFormModal.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import { useNotificationStore } from '../../stores/notificationStore';
import { translateApiError } from '../../utils/apiError.ts';
import { extractZodIssues, localizeZodIssues } from '../../utils/zodErrors.ts';

interface TypeItem {
  id: number;
  name: string;
}

const props = defineProps<{
  title: string;
  addLabel: string;
  editTitle: string;
  deleteTitle: string;
  deleteMessagePrefix: string;
  emptyMessage: string;
  items: TypeItem[];
  loading?: boolean;
  onCreate: (name: string) => Promise<unknown>;
  onUpdate: (id: number, name: string) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  saveErrorFallbackKey: string;
  deleteErrorFallbackKey: string;
  successCreateMessage: string;
  successUpdateMessage: string;
  successDeleteMessage: string;
  // Optional: when provided, an extra per-row button opens the caller's own
  // "manage documents" surface for that item (used by the Document Types
  // settings feature — kept optional so this component stays a generic
  // name-only type manager for anything that doesn't need it).
  onManageDocuments?: (item: TypeItem) => void;
  manageDocumentsLabel?: string;
}>();

const { t, te } = useI18n();
const notificationStore = useNotificationStore();

// Add/edit modal
const modalOpen = ref(false);
const editing = ref<TypeItem | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);

function openAdd() {
  editing.value = null;
  saveError.value = null;
  modalOpen.value = true;
}

function openEdit(item: TypeItem) {
  editing.value = item;
  saveError.value = null;
  modalOpen.value = true;
}

async function onSaved(name: string) {
  saving.value = true;
  saveError.value = null;

  try {
    if (editing.value) {
      await props.onUpdate(editing.value.id, name);
      notificationStore.showToast(props.successUpdateMessage, 'success');
    } else {
      await props.onCreate(name);
      notificationStore.showToast(props.successCreateMessage, 'success');
    }
    modalOpen.value = false;
  } catch (err: any) {
    const issues = extractZodIssues(err);
    if (issues) {
      saveError.value = localizeZodIssues(issues, t).join(' ');
    } else {
      saveError.value = translateApiError(err, { t, te }, props.saveErrorFallbackKey);
    }
  } finally {
    saving.value = false;
  }
}

// Delete confirmation
const isDeleteConfirmVisible = ref(false);
const itemToDelete = ref<TypeItem | null>(null);
const deleting = ref(false);

function openDeleteConfirm(item: TypeItem) {
  itemToDelete.value = item;
  isDeleteConfirmVisible.value = true;
}

function closeDeleteConfirm() {
  isDeleteConfirmVisible.value = false;
  itemToDelete.value = null;
}

async function confirmDelete() {
  if (!itemToDelete.value) return;
  deleting.value = true;

  try {
    await props.onDelete(itemToDelete.value.id);
    notificationStore.showToast(props.successDeleteMessage, 'success');
    closeDeleteConfirm();
  } catch (err: any) {
    closeDeleteConfirm();
    notificationStore.showModal(
      t('errors.deletion_not_possible_title'),
      translateApiError(err, { t, te }, props.deleteErrorFallbackKey),
    );
  } finally {
    deleting.value = false;
  }
}
</script>
