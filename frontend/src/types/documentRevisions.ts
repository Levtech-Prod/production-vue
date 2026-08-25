// The versions a revision-mode document type holds (migration 022).
//
// A card carries several versions; a version belongs to exactly one card, and
// at most one of a card's versions is `production`. Unlike a product revision,
// a version belongs to the product / sub-product itself — selecting a different
// product revision does not change what a card shows.
//
// The payload and status types come from the backend's zod schema so both sides
// describe the same shape from one source of truth. `import type` is erased at
// build time, so this pulls no zod (or any runtime code) into the bundle —
// which is also why the status list below is re-declared as a plain array
// rather than imported as a value.
import type {
  DocumentRevisionPayload as DocumentRevisionPayloadSchema,
  DocumentRevisionStatus,
} from '../../../backend/src/schemas/documentRevisions.schema.ts';

export type { DocumentRevisionStatus };
export type DocumentRevisionPayload = DocumentRevisionPayloadSchema;

/** Display order for the status filter and the form's status picker. */
export const DOCUMENT_REVISION_STATUSES = [
  'testing',
  'production',
  'deprecated',
] as const satisfies readonly DocumentRevisionStatus[];

/** A file attached to a version. Version files are never statically served, so
 *  unlike a document there is no public `path` — only `downloadUrl`. */
export interface DocumentRevisionFile {
  id: number;
  originalName: string;
  sizeBytes: number;
  mimeType: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface DocumentRevision {
  id: number;
  documentTypeId: number;
  name: string;
  status: DocumentRevisionStatus;
  releaseNotes: string | null;
  createdAt: string;
  updatedAt: string;
  /** null when the creating user has since been deleted. */
  createdByName: string | null;
  files: DocumentRevisionFile[];
}
