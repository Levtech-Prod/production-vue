// Which template family a document type belongs to — drives which pair of
// backend routes (product-types/... vs sub-product-types/...) is called.
export type DocumentTypeFamily = 'product' | 'sub-product';

export interface DocumentType {
  id: number;
  typeId: number;
  name: string;
  icon: string;
  allowedExtensions: string[];
  required: boolean;
  sortOrder: number;
  createdAt?: string;
}

/** Create and update use the same shape. */
export interface DocumentTypePayload {
  name: string;
  icon: string;
  allowedExtensions: string[];
  required: boolean;
}

export interface DeleteDocumentTypeResult {
  id: number;
  deleted: boolean;
  // How many files this type's files were demoted from (now in "Other
  // documents") — lets the caller tell the admin what just happened.
  filesMovedToOther: number;
}

/** In-progress edit buffer for one table row — either a new, unsaved row
 *  (`id: null`) or an existing row being edited in place. Used by
 *  DocumentTypesSection.vue / DocumentTypeRowForm.vue for inline add/edit,
 *  as opposed to the old separate-modal flow. */
export interface DocumentTypeDraft {
  id: number | null;
  name: string;
  icon: string;
  allowedExtensions: string[];
  required: boolean;
}
