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

  /**
   * Several files at once. `names` is index-aligned with `files`; an empty
   * entry keeps the uploaded file's own name. Re-uploading a name that already
   * exists on this firmware overwrites it rather than adding a second entry.
   *
   * One `names` part per file, appended in the same order — the server pairs
   * them by index, so a name must be sent even when it is blank.
   */
  uploadFiles(firmwareId: number, files: File[], names: string[] = []) {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    for (let i = 0; i < files.length; i += 1) form.append('names', names[i]?.trim() ?? '');
    return api.post<Firmware>(`/firmwares/${firmwareId}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  deleteFile(fileId: number) {
    return api.delete(`/firmware-files/${fileId}`);
  },
};
