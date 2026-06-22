import { defineStore } from 'pinia';
import { ref } from 'vue';
import { uploadService } from '../services/upload/uploadFile';
import type { UploadTarget } from '../api/uploadApi';

export const useUploadStore = defineStore('upload', () => {
  const uploading = ref(false);
  const error = ref<string | null>(null);

  async function uploadFile(target: UploadTarget, file: File): Promise<string> {
    uploading.value = true;
    error.value = null;

    try {
      return await uploadService.uploadFile(target, file);
    } catch (err) {
      console.error(err);
      error.value = 'File upload failed';
      throw err;
    } finally {
      uploading.value = false;
    }
  }

  return {
    uploading,
    error,
    uploadFile,
  };
});
