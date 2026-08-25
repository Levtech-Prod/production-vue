import { api } from './client.ts';
import type { DocumentTypeFamily } from '../types/documentTypes.ts';
import type { DocumentRevision, DocumentRevisionPayload } from '../types/documentRevisions.ts';

/** Versions hang off the CARD they belong to, so the list/create routes are
 *  nested under it; everything acting on one version is addressed by its own id
 *  instead. */
function cardBase(family: DocumentTypeFamily): string {
  return family === 'product' ? 'product-document-types' : 'sub-product-document-types';
}

export const documentRevisionsApi = {
  getAll(family: DocumentTypeFamily, documentTypeId: number) {
    return api.get<{ revisions: DocumentRevision[] }>(
      `/${cardBase(family)}/${documentTypeId}/revisions`,
    );
  },

  create(family: DocumentTypeFamily, documentTypeId: number, payload: DocumentRevisionPayload) {
    return api.post<DocumentRevision>(
      `/${cardBase(family)}/${documentTypeId}/revisions`,
      payload,
    );
  },

  update(revisionId: number, payload: DocumentRevisionPayload) {
    return api.put<DocumentRevision>(`/document-revisions/${revisionId}`, payload);
  },

  delete(revisionId: number) {
    return api.delete(`/document-revisions/${revisionId}`);
  },

  /**
   * Several files at once. `names` is index-aligned with `files`; an empty entry
   * keeps the uploaded file's own name. Re-uploading a name that already exists
   * on this version overwrites it rather than adding a second entry.
   *
   * One `names` part per file, appended in the same order — the server pairs
   * them by index, so a name must be sent even when it is blank.
   */
  uploadFiles(revisionId: number, files: File[], names: string[] = []) {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    for (let i = 0; i < files.length; i += 1) form.append('names', names[i]?.trim() ?? '');
    return api.post<DocumentRevision>(`/document-revisions/${revisionId}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  deleteFile(fileId: number) {
    return api.delete(`/document-revision-files/${fileId}`);
  },
};
