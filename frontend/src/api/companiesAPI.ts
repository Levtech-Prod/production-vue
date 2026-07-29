import { api } from './client.ts';
import type { Company, CreateCompanyPayload } from '../types/companies.ts';

export const companiesApi = {
  getAll() {
    return api.get<Company[]>('/companies');
  },

  create(payload: CreateCompanyPayload) {
    return api.post<Company>('/companies', payload);
  },

  delete(id: number) {
    return api.delete(`/companies/${id}`);
  },
};
