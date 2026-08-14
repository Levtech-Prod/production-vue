<template>
  <BaseModal v-model="open" :title="t(titleKey)" size="sm" :layer="layer">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-slate-500">{{ t('file_name_hint') }}</p>

      <!-- One row per picked file. Callers that upload a single file pass a
           one-element array; nothing about the layout special-cases it. -->
      <div v-for="(file, index) in files" :key="index" class="flex flex-col gap-1">
        <div
          class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
        >
          <FileText class="h-4 w-4 shrink-0 text-slate-400" />
          <span class="truncate" :title="file.name">{{ file.name }}</span>
          <span class="ml-auto shrink-0 text-xs text-slate-400">{{ formatBytes(file.size) }}</span>
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
        {{ uploading ? t('uploading') : t(titleKey) }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { FileText } from 'lucide-vue-next';
import BaseModal from './BaseModal.vue';
import { formatBytes } from '../../utils/formatters.ts';
import type { ModalLayer } from '../../utils/overlayLayers.ts';

/**
 * "Name these files before they upload." Shared by the documents panel (one
 * file) and the firmware section (up to twenty) — the two differ only in how
 * many rows they render and which layer they sit on, so they are one component
 * rather than two that drift.
 */
withDefaults(
  defineProps<{
    files: File[];
    /** i18n key for the heading, reused as the confirm button label. */
    titleKey: string;
    uploading: boolean;
    /** 'nested' when this can open from inside another dialog. */
    layer?: ModalLayer;
  }>(),
  { layer: 'modal' },
);

const emit = defineEmits<{ (e: 'confirm'): void }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });
/** Index-aligned with `files`; an empty entry keeps the original name. */
const names = defineModel<string[]>('names', { default: () => [] });
</script>
