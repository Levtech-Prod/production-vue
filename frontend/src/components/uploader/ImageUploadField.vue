<template>
  <div class="flex flex-col gap-1">
    <label
      v-if="label"
      class="text-xs font-medium text-slate-500 uppercase tracking-wide"
      >{{ label }} <span v-if="required" class="text-red-500">*</span></label
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
        <Trash2 class="h-3.5 w-3.5" />
        {{ t('remove_image') }}
      </button>
    </div>

    <!-- Uploader — shown when no image is set -->
    <FileUploader
      v-else
      :label="label"
      :target="target"
      :is-file-uploaded="false"
      :required="required"
      @uploaded="(url: string) => (modelValue = url)"
    />

    <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Trash2 } from 'lucide-vue-next';
import FileUploader from './FileUploader.vue';
import type { UploadTarget } from '../../api/uploadApi';

defineProps<{
  // Label shown above the field and passed through to FileUploader.
  label?: string;
  // Upload target folder (uploads/<target>), forwarded to FileUploader.
  target: UploadTarget;
  // Alt text for the saved-image preview thumbnail. Falls back to `label`.
  previewAlt?: string;
  // When true and no image is set yet, the underlying file input is marked
  // required so native form validation blocks submission without one.
  required?: boolean;
  // Translated validation message shown under the field (e.g. "is
  // required") — set by the parent form after a failed submit attempt.
  error?: string | null;
}>();

const { t } = useI18n();

// v-model binding for the uploaded image URL (or '' / null when empty).
const modelValue = defineModel<string | null | undefined>({ default: '' });
</script>
