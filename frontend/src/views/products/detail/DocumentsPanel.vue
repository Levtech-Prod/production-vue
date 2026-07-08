<template>
  <div class="flex-1 overflow-y-auto">
    <div class="px-4 pb-3 pt-3">
      <div class="mb-2 flex items-center justify-between">
        <span class="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
          {{ title }}
        </span>
        <label
          v-if="canEdit"
          class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          :title="t('upload_document')"
        >
          <Upload class="h-3.5 w-3.5" />
          {{ uploading ? t('uploading') : t('upload_document') }}
          <input
            type="file"
            class="sr-only"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.webp"
            :disabled="uploading"
            @change="onSelectFile"
          />
        </label>
      </div>

      <div v-if="loading" class="py-4 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </div>
      <div v-else-if="docs.length === 0" class="py-4 text-center text-sm text-slate-400">
        {{ emptyText }}
      </div>
      <ul v-else class="flex flex-col gap-1">
        <li
          v-for="doc in docs"
          :key="doc.id"
          class="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
        >
          <component :is="docIcon(doc.mimeType)" class="h-4 w-4 shrink-0 text-slate-400" />
          <a
            :href="doc.path"
            target="_blank"
            rel="noopener"
            class="min-w-0 flex-1 truncate text-sm text-slate-700 hover:text-blue-600 hover:underline"
          >
            {{ doc.originalName }}
          </a>
          <span class="shrink-0 text-[10px] text-slate-400">{{ formatDate(doc.createdAt) }}</span>
          <button
            v-if="canEdit"
            type="button"
            class="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            :title="t('delete_document')"
            @click="emit('delete-doc', doc)"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Upload, Trash2, FileText, FileSpreadsheet, File, Image } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatDate } from '../../../utils/formatDate.ts';
import type { ProductDocument } from '../../../types/products.ts';

defineProps<{
  title: string;
  docs: ProductDocument[];
  loading: boolean;
  uploading: boolean;
  canEdit: boolean;
  emptyText: string;
}>();

const emit = defineEmits<{
  (e: 'upload-file', file: File): void;
  (e: 'delete-doc', doc: ProductDocument): void;
}>();

const { t } = useI18n();

function onSelectFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // allow re-selecting the same file later
  if (file) emit('upload-file', file);
}

function docIcon(mimeType: string | null) {
  if (!mimeType) return File;
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('text'))
    return FileText;
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType.includes('csv'))
    return FileSpreadsheet;
  return File;
}
</script>
