export interface Company {
  id: number;
  name: string;
  createdAt?: string;
}

export interface CreateCompanyPayload {
  name: string;
}
