import { api } from './client.ts';
import type {
  ProductSummary,
  ProductDetail,
  ProductRevision,
  ProductPayload,
  NewRevisionPayload,
  SubProductSummary,
  SubProductRevision,
  SubProductPayload,
  NewSubProductRevisionPayload,
  RevisionPart,
  RevisionPartInput,
  CompareResult,
  ComparePartsResult,
  RevisionStatus,
  ProductStatus,
  ProductDocument,
  RevisionDocuments,
  BomSubProduct,
} from '../types/products.ts';
import type { PanelScope } from '../views/products/detail/types.ts';

export const productsApi = {
  getAll() {
    return api.get<ProductSummary[]>('/products');
  },
  getById(id: number) {
    return api.get<ProductDetail>(`/products/${id}`);
  },
  create(payload: ProductPayload) {
    return api.post<ProductSummary>('/products', payload);
  },
  update(id: number, payload: ProductPayload) {
    return api.patch<ProductSummary>(`/products/${id}`, payload);
  },
  getRevisions(id: number) {
    return api.get<ProductRevision[]>(`/products/${id}/revisions`);
  },
  createRevision(id: number, payload: NewRevisionPayload) {
    return api.post<ProductRevision>(`/products/${id}/revisions`, payload);
  },
  setDefaultRevision(id: number, revisionId: number | null) {
    return api.patch<{ id: number; defaultRevisionId: number | null }>(
      `/products/${id}/default-revision`,
      { revisionId },
    );
  },
  setStatus(id: number, status: ProductStatus) {
    // `sku` is included because reactivating can silently rename it (see
    // resolveSkuConflictOnReactivate on the backend) — callers need it to
    // detect and surface that change.
    return api.patch<{ id: number; sku: string; status: ProductStatus; updatedAt: string }>(
      `/products/${id}/status`,
      { status },
    );
  },
};

export const productRevisionsApi = {
  update(
    revId: number,
    payload: { label?: string; status?: RevisionStatus; changeNotes?: string | null },
  ) {
    return api.patch<ProductRevision>(`/product-revisions/${revId}`, payload);
  },
  setSubProducts(revId: number, subProductRevisionIds: number[]) {
    return api.patch(`/product-revisions/${revId}/sub-products`, {
      subProductRevisionIds,
    });
  },
  compare(a: number, b: number) {
    return api.get<CompareResult>('/product-revisions/compare', {
      params: { a, b },
    });
  },
  getBom(revId: number) {
    return api.get<BomSubProduct[]>(`/product-revisions/${revId}/bom`);
  },
};

export const subProductsApi = {
  getAll() {
    return api.get<SubProductSummary[]>('/sub-products');
  },
  create(productId: number, payload: SubProductPayload) {
    return api.post<SubProductSummary>('/sub-products', { ...payload, productId });
  },
  update(id: number, payload: SubProductPayload) {
    return api.patch<SubProductSummary>(`/sub-products/${id}`, payload);
  },
  delete(id: number) {
    return api.delete(`/sub-products/${id}`);
  },
  createRevision(id: number, payload: NewSubProductRevisionPayload) {
    return api.post<SubProductRevision>(`/sub-products/${id}/revisions`, payload);
  },
  updateRevision(
    spId: number,
    revId: number,
    payload: { label?: string; status?: RevisionStatus; changeNotes?: string | null },
  ) {
    return api.patch<SubProductRevision>(`/sub-products/${spId}/revisions/${revId}`, payload);
  },
  deleteRevision(spId: number, revId: number) {
    return api.delete(`/sub-products/${spId}/revisions/${revId}`);
  },
  getRevisionParts(spId: number, revId: number) {
    return api.get<RevisionPart[]>(
      `/sub-products/${spId}/revisions/${revId}/parts`,
    );
  },
  replaceRevisionParts(spId: number, revId: number, parts: RevisionPartInput[]) {
    return api.put<RevisionPart[]>(
      `/sub-products/${spId}/revisions/${revId}/parts`,
      { parts },
    );
  },
  compareRevisionParts(a: number, b: number) {
    return api.get<ComparePartsResult>('/sub-products/revisions/compare', {
      params: { a, b },
    });
  },
};

// Documents hang off a REVISION on both sides (document-system-plan.md §3.3),
// and the two families are served by structurally identical routes that differ
// only in their base path — so one factory covers both and `documentsApiFor`
// picks the right one from a PanelScope.
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

function uploadForm(file: File, name?: string, documentTypeId?: number | null): FormData {
  const formData = new FormData();
  formData.append('file', file);
  if (name && name.trim()) formData.append('name', name.trim());
  // Omitted -> the server files it under "Other documents".
  if (documentTypeId != null) formData.append('documentTypeId', String(documentTypeId));
  return formData;
}

function buildDocumentsApi(basePath: (revId: number) => string) {
  return {
    /** Grouped panel payload: cards, the "other" bucket and the summary. */
    getAll(revId: number) {
      return api.get<RevisionDocuments>(`${basePath(revId)}/documents`);
    },
    upload(revId: number, file: File, name?: string, documentTypeId?: number | null) {
      return api.post<ProductDocument>(
        `${basePath(revId)}/documents`,
        uploadForm(file, name, documentTypeId),
        multipart,
      );
    },
    /** Copy-on-write replace — only this revision's row is repointed. */
    replace(
      revId: number,
      docId: number,
      file: File,
      name?: string,
      documentTypeId?: number | null,
    ) {
      return api.put<ProductDocument>(
        `${basePath(revId)}/documents/${docId}`,
        uploadForm(file, name, documentTypeId),
        multipart,
      );
    },
    remove(revId: number, docId: number) {
      return api.delete(`${basePath(revId)}/documents/${docId}`);
    },
  };
}

const productRevisionDocumentsApi = buildDocumentsApi((revId) => `/product-revisions/${revId}`);

/** Sub-product routes are nested under their sub-product, so the id is bound
 *  in per call rather than baked into the base path. */
function subProductDocumentsApi(spId: number) {
  return buildDocumentsApi((revId) => `/sub-products/${spId}/revisions/${revId}`);
}

/** The right documents API for whatever the panel is currently showing. */
export function documentsApiFor(scope: PanelScope) {
  return scope.kind === 'product'
    ? productRevisionDocumentsApi
    : subProductDocumentsApi(scope.spId);
}
