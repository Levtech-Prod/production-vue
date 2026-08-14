import type {
  PartCategoryParameterType,
  PartCategory,
} from './partCategories.ts';
// Mirrors the backend's zod validation for this same payload (see
// backend/src/schemas/parts.schema.ts) — type-only, so no runtime cost.
import type { PartPayload } from '../../../backend/src/schemas/parts.schema.ts';
// Single source of truth for the currencies a price may be entered in.
import type { EntryCurrency } from '../../../backend/src/schemas/money.schema.ts';

export type { EntryCurrency };

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
  // Resolved display name. In a 'parameters' category it is generated, and
  // `namePrefix` holds the text the user actually typed — edit forms bind to
  // the prefix, never to `name`.
  name: string;
  namePrefix?: string | null;
  code: string;
  // Alternate codes the same part is ordered under at other companies.
  // Unlike `code`, not unique and not required.
  secondaryCodes?: string[];
  // Canonical price in EUR. `priceEntered*` record how it was entered.
  pricePerPiece: number | string;
  priceEnteredAmount?: number | string | null;
  priceEnteredCurrency?: EntryCurrency;
  priceRateUsed?: number | string | null;
  priceRateDate?: string | null;
  location?: string | null;
  description?: string | null;
  image?: string | null;
  category: PartCategory;
  parameters?: PartParameterValue[];
  createdAt?: string;
  updatedAt?: string;
  // Computed from stock_entries; populated by the GET /parts response
  totalQuantity?: number;
  avgPricePerPiece?: number;
}

export type PartPayloadParameter = NonNullable<PartPayload['parameters']>[number];

export type CreatePartPayload = PartPayload;
export type UpdatePartPayload = CreatePartPayload;

// Per-parameter filter state used by the parts table.
// text/dropdown/boolean -> `value`; number -> `min`/`max` interval.
export interface ParameterFilterValue {
  value?: string;
  min?: string;
  max?: string;
}

export type ParameterFilters = Record<number, ParameterFilterValue>;
