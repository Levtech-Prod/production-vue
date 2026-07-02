export type RevisionStatus = 'draft' | 'active' | 'deprecated';

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

// ---- Payloads -------------------------------------------------------------

export interface ProductPayload {
  name: string;
  sku: string;
  type?: string | null;
  description?: string | null;
  image?: string | null;
}

export interface NewRevisionPayload {
  label: string;
  changeNotes?: string | null;
  duplicateFromId?: number | null;
}

export interface RevisionPartInput {
  partId: number;
  quantity: number;
  unit?: string | null;
  notes?: string | null;
}

export interface SubProductPayload {
  name: string;
  sku: string;
  type?: string | null;
  description?: string | null;
  image?: string | null;
  // Parts for the auto-created first revision (Rev. 1). Optional.
  parts?: RevisionPartInput[];
}

// Editable row used by the parts picker (carries display fields).
export interface SelectedPart {
  partId: number;
  name: string;
  code: string;
  quantity: number;
  unit: string;
  notes: string;
}

export interface NewSubProductRevisionPayload {
  label: string;
  changeNotes?: string | null;
  duplicateFromId?: number | null;
  parts?: RevisionPartInput[];
}
