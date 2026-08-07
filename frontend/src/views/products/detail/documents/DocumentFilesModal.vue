<template>
  <BaseModal v-model="open" :title="group?.name ?? ''" size="md">
    <div v-if="group" class="flex flex-col gap-3">
      <p v-if="group.allowedExtensions.length > 0" class="text-xs text-slate-500">
        {{ t('allowed_extensions_hint', { list: group.allowedExtensions.join(', ') }) }}
      </p>

      <p v-if="group.files.length === 0" class="py-4 text-center text-sm text-slate-400">
        {{ t('no_uploaded_file') }}
      </p>

      <!-- Actions are always visible here (unlike the card's hover icons), so
           the list stays usable on touch devices. -->
      <ul v-else class="flex flex-col divide-y divide-slate-100">
        <li v-for="file in group.files" :key="file.id" class="flex items-center gap-3 py-2">
          <FileText class="h-4 w-4 shrink-0 text-slate-400" />

          <div class="min-w-0 flex-1">
            <a
              :href="file.path"
              target="_blank"
              rel="noopener"
              class="block truncate text-sm text-slate-700 hover:text-blue-600 hover:underline"
            >
              {{ file.originalName }}
            </a>
            <p class="text-xs text-slate-400">
              {{ formatBytes(file.sizeBytes) }} &middot; {{ formatDate(file.createdAt) }}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <a
              :href="file.downloadUrl"
              class="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              :title="t('download')"
            >
              <Download class="h-4 w-4" />
            </a>
            <label
              v-if="canEdit"
              class="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              :title="t('replace_document')"
            >
              <RefreshCw class="h-4 w-4" />
              <input
                type="file"
                class="sr-only"
                :accept="acceptAttr"
                @change="onReplaceFile($event, file)"
              />
            </label>
            <button
              v-if="canEdit"
              type="button"
              class="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              :title="t('delete_document')"
              @click="emit('delete-file', file)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </li>
      </ul>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('close') }}
      </button>
      <label v-if="canEdit" class="btn-primary cursor-pointer" :title="acceptHint">
        {{ t('upload_document') }}
        <input type="file" class="sr-only" :accept="acceptAttr" @change="onUploadFile" />
      </label>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, FileText, RefreshCw, Trash2 } from 'lucide-vue-next';
import BaseModal from '../../../../components/modal/BaseModal.vue';
import { formatBytes, formatDate } from '../../../../utils/formatters.ts';
import type { ProductDocument } from '../../../../types/products.ts';

/** What the modal needs about the card it was opened from. `files` comes
 *  straight from the panel payload, so a refresh after upload/replace/delete
 *  flows through without the modal holding its own copy. */
export interface DocumentFilesGroup {
  name: string;
  allowedExtensions: string[];
  files: ProductDocument[];
}

const props = defineProps<{
  group: DocumentFilesGroup | null;
  canEdit: boolean;
}>();

const emit = defineEmits<{
  (e: 'upload-file', file: File): void;
  (e: 'replace-file', doc: ProductDocument, file: File): void;
  (e: 'delete-file', doc: ProductDocument): void;
}>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const acceptAttr = computed(() =>
  props.group && props.group.allowedExtensions.length > 0
    ? props.group.allowedExtensions.join(',')
    : undefined,
);
const acceptHint = computed(() =>
  props.group && props.group.allowedExtensions.length > 0
    ? t('allowed_extensions_hint', { list: props.group.allowedExtensions.join(', ') })
    : t('upload_document'),
);

/** Read the picked file, then reset the input so the same file can be
 *  re-selected later (the change event won't fire for an identical value). */
function takeFile(event: Event): File | null {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = '';
  return file;
}

function onUploadFile(event: Event) {
  const file = takeFile(event);
  if (file) emit('upload-file', file);
}

function onReplaceFile(event: Event, doc: ProductDocument) {
  const file = takeFile(event);
  if (file) emit('replace-file', doc, file);
}
</script>
