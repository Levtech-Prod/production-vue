// Which template family a document type belongs to — drives which pair of
// backend routes (product-types/... vs sub-product-types/...) is called.
export type DocumentTypeFamily = 'product' | 'sub-product';

export interface DocumentType {
  /** The product / sub-product TYPE this belongs to; null when the type is
   *  scoped to a single product instead (`custom`). */
  typeId: number | null;
  id: number;
  name: string;
  icon: string;
  allowedExtensions: string[];
  required: boolean;
  sortOrder: number;
  createdAt?: string;
  /** Defined on one product / sub-product rather than inherited from its type
   *  — added from that entity's Documents panel, and only editable there, and
   *  the only kind that may be versioned. */
  custom: boolean;
  /** Holds versions rather than loose files. Its own section on the Documents
   *  panel; the settings page never offers it. */
  revisionMode: boolean;
}

/** Create and update use the same shape. */
export interface DocumentTypePayload {
  name: string;
  icon: string;
  allowedExtensions: string[];
  required: boolean;
  revisionMode: boolean;
}

export interface DeleteDocumentTypeResult {
  id: number;
  deleted: boolean;
  // How many files this type's files were demoted from (now in "Other
  // documents") — lets the caller tell the admin what just happened.
  filesMovedToOther: number;
  /** Versions have nowhere to be demoted to, so a versioned card takes them
   *  with it. Zero for every ordinary card. */
  versionsDeleted: number;
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
  revisionMode: boolean;
}
