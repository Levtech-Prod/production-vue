import { api } from './client.ts';
import type {
  ProductType,
  SubProductType,
  TypePayload,
} from '../types/productTypes.ts';

export const productTypesApi = {
  getAll() {
    return api.get<ProductType[]>('/product-types');
  },
  create(payload: TypePayload) {
    return api.post<ProductType>('/product-types', payload);
  },
  update(id: number, payload: TypePayload) {
    return api.put<ProductType>(`/product-types/${id}`, payload);
  },
  delete(id: number) {
    return api.delete(`/product-types/${id}`);
  },
};

export const subProductTypesApi = {
  getAll() {
    return api.get<SubProductType[]>('/sub-product-types');
  },
  create(payload: TypePayload) {
    return api.post<SubProductType>('/sub-product-types', payload);
  },
  update(id: number, payload: TypePayload) {
    return api.put<SubProductType>(`/sub-product-types/${id}`, payload);
  },
  delete(id: number) {
    return api.delete(`/sub-product-types/${id}`);
  },
};
