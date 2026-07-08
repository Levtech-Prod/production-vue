export type RevisionStatus = 'draft' | 'active' | 'deprecated';
export type ProductStatus = 'active' | 'archived';

// ---- Products -------------------------------------------------------------

export interface ProductRevision {
  id: number;
  revisionNumber: number;
  label: string;
  status: RevisionStatus;
  changeNotes?: string | null;
  createdAt?: string;
}

// Row in the products list (revisions are a compact summary).
export interface ProductSummary {
  id: number;
  name: string;
  sku: string;
  type?: string | null;
  image?: string | null;
  description?: string | null;
  status: ProductStatus;
  defaultRevisionId?: number | null;
  revisions: ProductRevision[];
  createdAt?: string;
  updatedAt?: string;
}

// ---- Sub-products ---------------------------------------------------------

export interface SubProductRevision {
  id: number;
  revisionNumber: number;
  label: string;
  status: RevisionStatus;
  changeNotes?: string | null;
  createdAt?: string;
}

export interface SubProductSummary {
  id: number;
  name: string;
  sku: string;
  type?: string | null;
  image?: string | null;
  description?: string | null;
  revisions: SubProductRevision[];
}

// ---- Product detail -------------------------------------------------------

// Which sub-product revisions belong to each product revision.
export interface RevisionMembership {
  productRevisionId: number;
  subProductRevisionId: number;
  position: number;
}

// A sub-product (with its revisions) as it appears on a product detail page.
export interface DetailSubProduct {
  id: number;
  name: string;
  sku: string;
  type?: string | null;
  image?: string | null;
  revisions: SubProductRevision[];
}

export interface ProductDetail {
  id: number;
  name: string;
  sku: string;
  type?: string | null;
  image?: string | null;
  description?: string | null;
  status: ProductStatus;
  defaultRevisionId?: number | null;
  createdAt?: string;
  updatedAt?: string;
  revisions: ProductRevision[];
  membership: RevisionMembership[];
  subProducts: DetailSubProduct[];
}

// ---- Parts (leaf) ---------------------------------------------------------

// A part row inside a sub-product revision (reuses the existing parts table).
export interface RevisionPart {
  id: number;
  name: string;
  code: string;
  categoryId: number;
  pricePerPiece: number | string;
  image?: string | null;
  quantity: number | string;
  unit?: string | null;
  notes?: string | null;
}

// ---- Compare --------------------------------------------------------------

export type CompareStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface CompareSide {
  subProductRevisionId: number;
  revisionNumber: number;
  revisionLabel: string;
  revisionStatus: RevisionStatus;
}

export interface CompareSubProduct {
  subProductId: number;
  name: string;
  sku: string;
  inA: CompareSide | null;
  inB: CompareSide | null;
  status: CompareStatus;
}

export interface CompareResult {
  a: number;
  b: number;
  subProducts: CompareSubProduct[];
}

// ---- Parts compare --------------------------------------------------------

export interface ComparePartSide {
  quantity: number;
  unit?: string | null;
  notes?: string | null;
}

export interface ComparePartParameter {
  name: string;
  value: string;
  unit?: string | null;
  type?: string;
}

export interface ComparePartRow {
  partId: number;
  name: string;
  code: string;
  image?: string | null;
  pricePerPiece?: number | string | null;
  categoryName?: string | null;
  parameters?: ComparePartParameter[];
  inA: ComparePartSide | null;
  inB: ComparePartSide | null;
  status: CompareStatus;
}

export interface ComparePartsResult {
  a: number; // subProductRevisionId A
  b: number; // subProductRevisionId B
  parts: ComparePartRow[];
}

// ---- Documents ------------------------------------------------------------

export interface ProductDocument {
  id: number;
  originalName: string;
  filename: string;
  mimeType: string | null;
  path: string;
  createdAt: string;
}

// ---- BOM ------------------------------------------------------------------

export interface BomPart {
  id: number;
  name: string;
  code: string;
  image?: string | null;
  quantity: number;
  unit?: string | null;
  notes?: string | null;
}

export interface BomSubProduct {
  subProductId: number;
  subProductName: string;
  subProductSku: string;
  subProductRevisionId: number;
  subProductRevisionLabel: string;
  parts: BomPart[];
}

// ---- Payloads ---------------------------------------------------------------
//
// These mirror the request bodies the backend validates with zod (see
// backend/src/schemas/*.schema.ts). They're re-exported here as type-only
// imports so both sides describe the same shape from one source of truth —
// this never pulls zod itself (or any runtime code) into the frontend
// bundle, since `import type` is fully erased at build time.

import type { ProductPayload as ProductPayloadSchema, NewRevisionInput } from '../../../backend/src/schemas/products.schema.ts';
import type { RevisionPartInput as RevisionPartInputSchema } from '../../../backend/src/schemas/parts.schema.ts';
import type {
  CreateSubProductInput,
  NewSubProductRevisionInput,
} from '../../../backend/src/schemas/subProducts.schema.ts';

export type ProductPayload = ProductPayloadSchema;
export type NewRevisionPayload = NewRevisionInput;
export type RevisionPartInput = RevisionPartInputSchema;
// The backend's create schema also carries `productId` — the frontend adds
// that separately (see subProductsApi.create), so it's omitted here.
export type SubProductPayload = Omit<CreateSubProductInput, 'productId'>;
export type NewSubProductRevisionPayload = NewSubProductRevisionInput;

// Editable row used by the parts picker (carries display fields).
export interface SelectedPart {
  partId: number;
  name: string;
  code: string;
  quantity: number;
  unit: string;
  notes: string;
}
