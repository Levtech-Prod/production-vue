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
function buildDocumentTypesApi(
  typeBasePath: string,
  itemBasePath: string,
  entityBasePath: string,
) {
  return {
    getAll(typeId: number) {
      return api.get<DocumentType[]>(`/${typeBasePath}/${typeId}/document-types`);
    },
    create(typeId: number, payload: DocumentTypePayload) {
      return api.post<DocumentType>(`/${typeBasePath}/${typeId}/document-types`, payload);
    },
    /** Create one scoped to a single product / sub-product rather than to its
     *  type — the Documents panel's "add document type". There is no matching
     *  getter: these arrive with the panel payload, not on their own. */
    createForEntity(entityId: number, payload: DocumentTypePayload) {
      return api.post<DocumentType>(`/${entityBasePath}/${entityId}/document-types`, payload);
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
const productDocumentTypesApi = buildDocumentTypesApi(
  'product-types',
  'product-document-types',
  'products',
);
const subProductDocumentTypesApi = buildDocumentTypesApi(
  'sub-product-types',
  'sub-product-document-types',
  'sub-products',
);

// Picks the right API object for a family — used by DocumentTypesSection.vue
// (one instance per expanded settings row) and by the Documents panel's
// useDocuments composable.
export function documentTypesApiFor(family: DocumentTypeFamily) {
  return family === 'product' ? productDocumentTypesApi : subProductDocumentTypesApi;
}
