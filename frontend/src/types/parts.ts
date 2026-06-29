import type {
  PartCategoryParameterType,
  PartCategory,
} from './partCategories.ts';

export interface PartParameterValue {
  id?: number;
  partId?: number;
  parameterId: number;
  value: string;
  parameter?: {
    id: number;
    name: string;
    type: PartCategoryParameterType;
    unit?: string | null;
    required: boolean;
  };
}

export interface Part {
  id: number;
  categoryId: number;
  name: string;
  code: string;
  pricePerPiece: number | string;
  location?: string | null;
  description?: string | null;
  category: PartCategory;
  parameters?: PartParameterValue[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PartPayloadParameter {
  parameterId: number;
  value: string;
}

export interface CreatePartPayload {
  categoryId: number;
  name: string;
  code: string;
  pricePerPiece: number;
  location?: string | null;
  description?: string | null;
  parameters: PartPayloadParameter[];
}

export type UpdatePartPayload = CreatePartPayload;
