// The edit buffer behind both document type forms — the settings table row
// (views/settings/DocumentTypeRowForm.vue) and the Documents panel's modal
// (views/products/detail/documents/DocumentTypeFormModal.vue). They render
// differently but hold the same four fields under the same rules, so the
// shape, its defaults and its one validation rule live here rather than being
// written out twice.
import type { DocumentTypeDraft, DocumentTypePayload } from '../types/documentTypes.ts';

/** What a document type starts as before the admin picks anything. */
export const DEFAULT_DOCUMENT_TYPE_ICON = 'file';

/** Anything with the fields a draft is built from — a `DocumentType` from the
 *  settings API or a `DocumentTypeGroup` from the panel payload. */
interface DocumentTypeLike {
  id: number;
  name: string;
  icon: string;
  allowedExtensions: string[];
  required: boolean;
}

/** A blank draft for a new, unsaved document type. */
export function emptyDocumentTypeDraft(): DocumentTypeDraft {
  return {
    id: null,
    name: '',
    icon: DEFAULT_DOCUMENT_TYPE_ICON,
    allowedExtensions: [],
    required: true,
  };
}

/** A draft seeded from an existing record. `allowedExtensions` is copied, not
 *  shared: the form edits the array in place, so cancelling an edit must not
 *  leave the list it came from already changed. */
export function documentTypeDraftFrom(item: DocumentTypeLike): DocumentTypeDraft {
  return {
    id: item.id,
    name: item.name,
    icon: item.icon,
    allowedExtensions: [...item.allowedExtensions],
    required: item.required,
  };
}

/** The request body for a draft. Trims here so no caller has to remember to. */
export function documentTypePayloadFrom(draft: DocumentTypeDraft): DocumentTypePayload {
  return {
    name: draft.name.trim(),
    icon: draft.icon,
    allowedExtensions: draft.allowedExtensions,
    required: draft.required,
  };
}

/**
 * The draft's one client-side rule: a name is required. Returns a localized
 * message, or null when the draft is good to send. Everything else
 * (extensions, icon) is either normalised or already constrained to a valid
 * value by the inputs themselves.
 */
export function documentTypeNameError(
  draft: DocumentTypeDraft,
  t: (key: string) => string,
): string | null {
  return draft.name.trim() ? null : `${t('name')}: ${t('validation.required')}`;
}

/** Mirrors the backend's canonical extension format (see
 *  backend/src/schemas/documentTypes.schema.ts) so the chip an admin sees
 *  in the shared ChipsInput matches what's actually saved. Returns '' for a
 *  blank or dot-only entry so ChipsInput rejects it. */
export function normalizeExtensionChip(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === '.') return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}
