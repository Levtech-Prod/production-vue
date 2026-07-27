import { defineStore } from 'pinia';
import { ref } from 'vue';
import { companiesApi } from '../api/companiesAPI.ts';
import type { Company, CreateCompanyPayload } from '../types/companies.ts';

export const useCompaniesStore = defineStore('companies', () => {
  const companies = ref<Company[]>([]);
  const loading = ref(false);

  async function loadCompanies() {
    if (companies.value.length > 0) return; // already loaded
    loading.value = true;
    try {
      const res = await companiesApi.getAll();
      companies.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function createCompany(payload: CreateCompanyPayload): Promise<Company> {
    const res = await companiesApi.create(payload);
    companies.value = [...companies.value, res.data].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return res.data;
  }

  return { companies, loading, loadCompanies, createCompany };
});
