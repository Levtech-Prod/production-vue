import { api } from './client.ts';

import type {
  Part,
  CreatePartPayload,
  UpdatePartPayload,
} from '../types/parts.ts';

export const partsApi = {
  getAll() {
    return api.get<Part[]>('/parts');
  },

  getById(id: number) {
    return api.get<Part>(`/parts/${id}`);
  },

  create(payload: CreatePartPayload) {
    return api.post<Part>('/parts', payload);
  },

  update(id: number, payload: UpdatePartPayload) {
    return api.put<Part>(`/parts/${id}`, payload);
  },

  delete(id: number) {
    return api.delete(`/parts/${id}`);
  },
};
