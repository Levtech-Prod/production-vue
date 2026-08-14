<template>
  <BaseModal v-model="open" :title="t('upload_file')" size="sm">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-slate-500">{{ t('file_name_hint') }}</p>

      <!-- One row per picked file: firmware uploads take several at once, so
           the name field repeats rather than the modal. -->
      <div v-for="(file, index) in files" :key="index" class="flex flex-col gap-1">
        <div
          class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
        >
          <FileDigit class="h-4 w-4 shrink-0 text-slate-400" />
          <span class="truncate" :title="file.name">{{ file.name }}</span>
          <span class="ml-auto shrink-0 text-xs text-slate-400">
            {{ formatBytes(file.size) }}
          </span>
        </div>
        <input
          v-model="names[index]"
          type="text"
          class="input"
          :placeholder="file.name"
          :aria-label="t('file_name')"
          @keyup.enter="emit('confirm')"
        />
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="button" class="btn-primary" :disabled="uploading" @click="emit('confirm')">
        {{ uploading ? t('uploading') : t('upload_file') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { FileDigit } from 'lucide-vue-next';
import BaseModal from '../../../../components/modal/BaseModal.vue';
import { formatBytes } from '../../../../utils/formatters.ts';

defineProps<{
  files: File[];
  uploading: boolean;
}>();

const emit = defineEmits<{ (e: 'confirm'): void }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });
/** Index-aligned with `files`; an empty entry keeps the original name. */
const names = defineModel<string[]>('names', { default: () => [] });
</script>
