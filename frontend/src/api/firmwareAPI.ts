import { api } from './client.ts';
import type { Firmware, FirmwarePayload } from '../types/firmware.ts';

/**
 * Firmware hangs off a sub-product REVISION, so the list/create routes are
 * nested under it the same way documents are; everything acting on one
 * firmware is addressed by its own id instead.
 */
export const firmwaresApi = {
  getAll(spId: number, revId: number) {
    return api.get<{ firmwares: Firmware[] }>(
      `/sub-products/${spId}/revisions/${revId}/firmwares`,
    );
  },

  create(spId: number, revId: number, payload: FirmwarePayload) {
    return api.post<Firmware>(
      `/sub-products/${spId}/revisions/${revId}/firmwares`,
      payload,
    );
  },

  update(firmwareId: number, payload: FirmwarePayload) {
    return api.put<Firmware>(`/firmwares/${firmwareId}`, payload);
  },

  delete(firmwareId: number) {
    return api.delete(`/firmwares/${firmwareId}`);
  },

  /** Several files at once. Re-uploading a name that already exists on this
   *  firmware overwrites it rather than adding a second entry. */
  uploadFiles(firmwareId: number, files: File[]) {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return api.post<Firmware>(`/firmwares/${firmwareId}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  deleteFile(fileId: number) {
    return api.delete(`/firmware-files/${fileId}`);
  },
};
