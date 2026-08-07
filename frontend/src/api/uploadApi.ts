import { api } from './client';

// Product and sub-product images upload to 'temp': they are picked before the
// entity exists, so the backend files them into the product's folder on save.
export type UploadTarget = 'part-categories' | 'parts' | 'suppliers' | 'temp';

export interface UploadResponse {
  filename: string;
  path: string;
}

export const uploadApi = {
  uploadFile(target: UploadTarget, file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return api.post<UploadResponse>(`/upload/${target}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
};
