export interface PartCategoryParameter {
  id?: number;
  category_id?: number;
  name: string;
  type: string;
  unit?: string;
  required: boolean;
  created_at?: string;
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
  parameters: PartCategoryParameter[];
}
