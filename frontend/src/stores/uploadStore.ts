import { defineStore } from 'pinia';
import { ref } from 'vue';
import { uploadService } from '../services/upload/uploadFile';
import { i18n } from '../i18n';
import { translateApiError } from '../utils/apiError';
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
      error.value = translateApiError(
        err,
        { t: i18n.global.t, te: i18n.global.te },
        'errors.file_upload_failed',
      );
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
