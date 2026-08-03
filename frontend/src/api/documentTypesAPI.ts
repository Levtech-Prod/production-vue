import { api } from './client.ts';
import type {
  DeleteDocumentTypeResult,
  DocumentType,
  DocumentTypeFamily,
  DocumentTypePayload,
} from '../types/documentTypes.ts';

// Product and sub-product document types are served by structurally
// identical route pairs (see backend/src/routes/documentTypes.ts) — only the
// URL segment differs. One factory keeps the two APIs from drifting.
function buildDocumentTypesApi(typeBasePath: string, itemBasePath: string) {
  return {
    getAll(typeId: number) {
      return api.get<DocumentType[]>(`/${typeBasePath}/${typeId}/document-types`);
    },
    create(typeId: number, payload: DocumentTypePayload) {
      return api.post<DocumentType>(`/${typeBasePath}/${typeId}/document-types`, payload);
    },
    update(id: number, payload: DocumentTypePayload) {
      return api.put<DocumentType>(`/${itemBasePath}/${id}`, payload);
    },
    remove(id: number) {
      return api.delete<DeleteDocumentTypeResult>(`/${itemBasePath}/${id}`);
    },
    // Full ordered id list for the type — array position becomes sort_order.
    reorder(typeId: number, orderedIds: number[]) {
      return api.put<DocumentType[]>(`/${typeBasePath}/${typeId}/document-types/reorder`, {
        orderedIds,
      });
    },
  };
}

// Not exported directly — callers go through documentTypesApiFor() below,
// which is the only thing anything outside this file needs.
const productDocumentTypesApi = buildDocumentTypesApi('product-types', 'product-document-types');
const subProductDocumentTypesApi = buildDocumentTypesApi(
  'sub-product-types',
  'sub-product-document-types',
);

// Picks the right API object for a family — used by DocumentTypesSection.vue,
// which is instantiated once per expanded row and keeps its own local state
// (no shared store needed: each instance already only ever needs one family).
export function documentTypesApiFor(family: DocumentTypeFamily) {
  return family === 'product' ? productDocumentTypesApi : subProductDocumentTypesApi;
}
