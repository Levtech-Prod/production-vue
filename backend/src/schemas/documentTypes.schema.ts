import { z } from 'zod';

// Curated `lucide-vue-next` icon names admins may pick for a document type
// card (Story 4's IconPicker + the panel's card icons both resolve against
// this same list, so a name saved here is always renderable — see
// document-system-plan.md §5 "shared resolveIcon(name) helper"). Kept
// backend-side so create/update can reject anything outside the curated set
// instead of trusting arbitrary client-supplied icon names.
export const DOCUMENT_TYPE_ICONS = [
  // Generic files / documents
  'file', 'file-text', 'file-code', 'file-archive', 'file-check', 'file-cog',
  'file-digit', 'file-image', 'file-input', 'file-output', 'file-lock',
  'file-scan', 'file-search', 'file-spreadsheet', 'file-stack', 'file-symlink',
  'file-type', 'file-badge', 'file-box', 'file-terminal', 'file-clock',
  // Folders / archives
  'folder', 'folder-open', 'folder-tree', 'folder-archive', 'folder-cog',
  'archive',
  // Engineering / manufacturing
  'circuit-board', 'cpu', 'component', 'drill', 'factory', 'layers',
  'ruler', 'wrench', 'settings', 'flask-conical', 'printer',
  // Packaging / inventory
  'package', 'box', 'boxes',
  // Docs / process
  'clipboard', 'clipboard-list', 'clipboard-check', 'book-open', 'book-text',
  // Code / firmware
  'binary', 'terminal', 'database', 'hard-drive', 'scan',
  // Misc
  'shield-check', 'download', 'upload',
] as const;

export type DocumentTypeIcon = (typeof DOCUMENT_TYPE_ICONS)[number];

const iconSchema = z.enum(DOCUMENT_TYPE_ICONS);

// Normalises a raw extension string to the canonical "leading dot, lowercase,
// no surrounding whitespace" form (".zip", not "ZIP" or "zip "), so storage
// and the upload-time allow-list check never have to special-case formatting.
function normalizeExtension(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

const allowedExtensionsSchema = z
  .array(z.string().trim().min(1).max(20))
  .default([])
  .transform((exts) => {
    const normalized = exts.map(normalizeExtension).filter((e) => e !== '.');
    return Array.from(new Set(normalized));
  });

/** Create and update use the same shape. */
export const documentTypePayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: iconSchema,
  allowedExtensions: allowedExtensionsSchema,
  required: z.boolean().default(true),
});
export type DocumentTypePayload = z.infer<typeof documentTypePayloadSchema>;

/** Body for PUT .../document-types/reorder — the full, ordered list of ids
 *  belonging to the type being reordered. Array position becomes sort_order. */
export const documentTypeReorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()).min(1),
});
export type DocumentTypeReorderPayload = z.infer<typeof documentTypeReorderSchema>;
