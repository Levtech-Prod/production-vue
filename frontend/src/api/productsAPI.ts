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
  CompareResult,
  ComparePartsResult,
  RevisionStatus,
  ProductStatus,
  ProductDocument,
} from '../types/products.ts';

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
    return api.patch<{ id: number; status: ProductStatus; updatedAt: string }>(
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
};

export const subProductsApi = {
  getAll() {
    return api.get<SubProductSummary[]>('/sub-products');
  },
  create(payload: SubProductPayload) {
    return api.post<SubProductSummary>('/sub-products', payload);
  },
  update(id: number, payload: SubProductPayload) {
    return api.patch<SubProductSummary>(`/sub-products/${id}`, payload);
  },
  createRevision(id: number, payload: NewSubProductRevisionPayload) {
    return api.post<SubProductRevision>(`/sub-products/${id}/revisions`, payload);
  },
  getRevisionParts(spId: number, revId: number) {
    return api.get<RevisionPart[]>(
      `/sub-products/${spId}/revisions/${revId}/parts`,
    );
  },
  compareRevisionParts(a: number, b: number) {
    return api.get<ComparePartsResult>('/sub-products/revisions/compare', {
      params: { a, b },
    });
  },
};

export const documentsApi = {
  getProductDocuments(productId: number) {
    return api.get<ProductDocument[]>(`/products/${productId}/documents`);
  },
  uploadProductDocument(productId: number, file: File, name?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (name && name.trim()) formData.append('name', name.trim());
    return api.post<ProductDocument>(`/products/${productId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteProductDocument(productId: number, docId: number) {
    return api.delete(`/products/${productId}/documents/${docId}`);
  },
  getSpRevisionDocuments(spId: number, revId: number) {
    return api.get<ProductDocument[]>(`/sub-products/${spId}/revisions/${revId}/documents`);
  },
  uploadSpRevisionDocument(spId: number, revId: number, file: File, name?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (name && name.trim()) formData.append('name', name.trim());
    return api.post<ProductDocument>(`/sub-products/${spId}/revisions/${revId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteSpRevisionDocument(spId: number, revId: number, docId: number) {
    return api.delete(`/sub-products/${spId}/revisions/${revId}/documents/${docId}`);
  },
};
