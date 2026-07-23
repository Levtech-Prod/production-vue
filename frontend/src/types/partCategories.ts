export type PartCategoryParameterType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'dropdown';
export interface PartCategoryParameter {
  id?: number;
  category_id?: number;
  name: string;
  type: PartCategoryParameterType;
  unit?: string;
  required: boolean;
  created_at?: string;
  options: string[]; // Only for dropdown type
}

export interface PartCategory {
  id: number;
  name: string;
  description: string;
  image?: string | null;
  parameters?: PartCategoryParameter[];
  created_at?: string;
}

export interface CreatePartCategoryPayload {
  name: string;
  description: string;
  image?: string | null;
  // Optional: parameters are managed inline on the categories page, not in the
  // category-details modal. Omit to leave a category's parameters untouched.
  parameters?: PartCategoryParameter[];
}

export interface UpdatePartCategoryPayload {
  name: string;
  description: string;
  image?: string | null;
  parameters?: PartCategoryParameter[];
}
