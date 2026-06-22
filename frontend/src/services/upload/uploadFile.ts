import { uploadApi, type UploadTarget } from '../../api/uploadApi';

export const uploadService = {
  async uploadFile(target: UploadTarget, file: File): Promise<string> {
    const response = await uploadApi.uploadFile(target, file);

    return response.data.url;
  },
};
