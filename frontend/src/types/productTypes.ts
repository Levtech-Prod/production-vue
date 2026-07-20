export interface ProductType {
  id: number;
  name: string;
  createdAt?: string;
}

export interface SubProductType {
  id: number;
  name: string;
  createdAt?: string;
}

export interface TypePayload {
  name: string;
}
