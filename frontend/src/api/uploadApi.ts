import { api } from './client';

export type UploadTarget =
  | 'part-categories'
  | 'parts'
  | 'products'
  | 'sub-products'
  | 'suppliers'
  | 'temp';

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
