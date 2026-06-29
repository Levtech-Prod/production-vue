<script setup lang="ts">
import { ref, watch } from 'vue';
import { useUploadStore } from '../../stores/uploadStore';
import type { UploadTarget } from '../../api/uploadApi';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  label?: string;
  target: UploadTarget;
  isFileUploaded?: boolean;
}>();

const emit = defineEmits<{
  uploaded: [url: string];
}>();

const uploadStore = useUploadStore();
const previewUrl = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.isFileUploaded,
  (newVal: boolean) => {
    if (!newVal) {
      previewUrl.value = null;
    }

    if (newVal && fileInput.value) {
      fileInput.value.value = '';
    }
  },
);

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;

  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];

  previewUrl.value = URL.createObjectURL(file);

  const uploadedUrl = await uploadStore.uploadFile(props.target, file);

  emit('uploaded', uploadedUrl);
}
</script>

<template>
  <div class="space-y-3">
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      @change="handleFileChange"
      class="block w-full rounded-lg border border-gray-300 p-2 text-sm"
    />

    <p v-if="uploadStore.uploading" class="text-sm text-gray-500">
      {{ t('in-progress') }}
    </p>

    <p v-if="uploadStore.error" class="text-sm text-red-500">
      {{ uploadStore.error }}
    </p>

    <img
      v-if="previewUrl"
      :src="previewUrl"
      class="h-24 w-24 rounded-lg border object-cover"
    />
  </div>
</template>
