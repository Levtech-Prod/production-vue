<template>
  <div class="flex flex-col gap-1">
    <label
      v-if="label"
      class="text-xs font-medium text-slate-500 uppercase tracking-wide"
      >{{ label }}</label
    >

    <!-- Existing image preview -->
    <div
      v-if="modelValue"
      class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3"
    >
      <img
        :src="modelValue"
        class="h-16 w-16 rounded-lg border border-slate-200 object-cover shrink-0"
        :alt="previewAlt || label"
      />
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 border border-red-200 transition-colors shrink-0"
        @click="modelValue = ''"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
        {{ t('remove_image') }}
      </button>
    </div>

    <!-- Uploader — shown when no image is set -->
    <FileUploader
      v-else
      :label="label"
      :target="target"
      :is-file-uploaded="false"
      @uploaded="(url: string) => (modelValue = url)"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import FileUploader from './FileUploader.vue';
import type { UploadTarget } from '../../api/uploadApi';

defineProps<{
  // Label shown above the field and passed through to FileUploader.
  label?: string;
  // Upload target folder (uploads/<target>), forwarded to FileUploader.
  target: UploadTarget;
  // Alt text for the saved-image preview thumbnail. Falls back to `label`.
  previewAlt?: string;
}>();

const { t } = useI18n();

// v-model binding for the uploaded image URL (or '' / null when empty).
const modelValue = defineModel<string | null | undefined>({ default: '' });
</script>
