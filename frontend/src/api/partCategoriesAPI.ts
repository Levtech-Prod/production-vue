import { api } from './client.ts';

import type {
  PartCategory,
  PartCategoryParameter,
  CreatePartCategoryPayload,
  UpdatePartCategoryPayload,
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

  update(id: number, payload: UpdatePartCategoryPayload) {
    return api.put<PartCategory>(`/part-categories/${id}`, payload);
  },

  delete(id: number) {
    return api.delete(`/part-categories/${id}`);
  },

  // Toggle a single parameter's "show as column" flag.
  setParameterColumn(
    categoryId: number,
    parameterId: number,
    showAsColumn: boolean,
  ) {
    return api.patch<PartCategoryParameter>(
      `/part-categories/${categoryId}/parameters/${parameterId}`,
      { showAsColumn },
    );
  },
};
