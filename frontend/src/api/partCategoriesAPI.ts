import { api } from './client.ts';

import type {
  PartCategory,
  CreatePartCategoryPayload,
} from '../types/partCategories.ts';

export const partCategoriesApi = {
  getAll() {
    return api.get<PartCategory[]>('/part-categories');
  },

  getById(id: number) {
    return api.get<PartCategory>(`/part-categories/${id}`);
  },

  create(payload: CreatePartCategoryPayload) {
    return api.post<PartCategory>('/part-categories', payload);
  },

  update(id: number, payload: CreatePartCategoryPayload) {
    return api.put<PartCategory>(`/part-categories/${id}`, payload);
  },

  delete(id: number) {
    return api.delete(`/part-categories/${id}`);
  },
};
