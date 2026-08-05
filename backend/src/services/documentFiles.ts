// ===========================================================================
// Document file sharing — carry-forward, copy-on-write, cleanup.
// (document-system-plan.md §3.2–§3.4, Story 2.)
// ---------------------------------------------------------------------------
// Every physical document file is recorded once in `stored_files`; the thin
// per-revision rows (`product_revision_documents` /
// `sub_product_revision_documents`) only point at it. That indirection buys
// three behaviours, all implemented here:
//
//   * Carry-forward — a new revision copies the previous revision's document
//     ROWS, pointing at the same `stored_file_id`s. Nothing is written to disk.
//   * Copy-on-write — replacing a file never mutates a shared file in place;
//     it stores a NEW file and repoints only that one revision's row, so a
//     revision sharing the old file is untouched.
//   * Cleanup — deleting or replacing runs a stateless "is anything else still
//     pointing at this file?" check (no reference counters to drift) and the
//     physical file is unlinked only when the answer is no.
//
// Filesystem note: an unlink cannot be rolled back, so the DB-side helpers here
// never touch the disk. They return the storage key of a file that has become
// unreferenced and the caller unlinks it with `unlinkStoredFile` AFTER its
// transaction commits.
// ===========================================================================
import fs from 'fs';
import path from 'path';
import type { QueryResult, QueryResultRow } from 'pg';

/** Anything that can run a parameterized query — the pool or a tx client. */
export interface Queryable {
  query<T extends QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

/** Which family of revision documents a call operates on. */
export type DocumentScope = 'product' | 'subProduct';

interface ScopeConfig {
  /** Per-revision documents table. */
  table: string;
  /** Its FK column back to the owning revision. */
  revisionColumn: string;
  /** Revisions table for this family. */
  revisionTable: string;
  /** The revisions table's FK column back to the owning entity. */
  entityColumn: string;
  /** The owning entity's table (products / sub_products). */
  entityTable: string;
  /** Managed type list the entity's `type` column names. */
  typeTable: string;
  /** Per-type document requirement templates. */
  documentTypeTable: string;
  /** The template table's FK column back to the type list. */
  documentTypeColumn: string;
  /** Prefix of the entity's on-disk folder name (plan §3.2). */
  folderPrefix: string;
}

// Table and column names are read only from this literal map — never from
// request input — so interpolating them into SQL is safe. All *values* stay
// parameterized.
const SCOPES: Record<DocumentScope, ScopeConfig> = {
  product: {
    table: 'product_revision_documents',
    revisionColumn: 'product_revision_id',
    revisionTable: 'product_revisions',
    entityColumn: 'product_id',
    entityTable: 'products',
    typeTable: 'product_types',
    documentTypeTable: 'product_document_types',
    documentTypeColumn: 'product_type_id',
    folderPrefix: '',
  },
  subProduct: {
    table: 'sub_product_revision_documents',
    revisionColumn: 'sub_product_revision_id',
    revisionTable: 'sub_product_revisions',
    entityColumn: 'sub_product_id',
    entityTable: 'sub_products',
    typeTable: 'sub_product_types',
    documentTypeTable: 'sub_product_document_types',
    documentTypeColumn: 'sub_product_type_id',
    folderPrefix: 'sub-',
  },
};

// ── Filesystem ─────────────────────────────────────────────────────────────

export const documentsDir = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });

/**
 * Make a string safe to use as a single path segment (folder or file name):
 * strip path separators / control chars and guard against traversal.
 */
export function sanitizeSegment(input: string): string {
  const cleaned = input
    .replace(/[/\\]/g, '_') // path separators
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '') // control chars
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return '_';
  return cleaned;
}

/**
 * The on-disk folder holding every file of one product / sub-product — across
 * ALL of its revisions, which is what lets revisions share a file without
 * duplicating it (plan §3.2).
 *
 * Resolution matches on the immutable `{id}-` prefix ("4-", "sub-12-"), not the
 * full name: an existing folder is reused whatever its name suffix, so renaming
 * a product can never fragment it into two folders and existing `storage_key`s
 * never need rewriting. A folder is only created when no prefix match exists.
 */
export function resolveEntityFolder(
  scope: DocumentScope,
  entityId: number,
  name: string,
  sku: string | null,
): string {
  const idPrefix = `${SCOPES[scope].folderPrefix}${entityId}-`;

  const existing = fs
    .readdirSync(documentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(idPrefix))
    .map((entry) => entry.name)
    .sort()[0];
  if (existing) return existing;

  // Spaces in the name become dashes so the folder is a single tidy token.
  // Sub-products may have no SKU (migration 002) — then it is just "{id}-{name}".
  const dashedName = name.replace(/\s+/g, '-');
  const suffix = sku ? `-${sku}` : '';
  const folder = sanitizeSegment(`${idPrefix}${dashedName}${suffix}`);
  fs.mkdirSync(path.join(documentsDir, folder), { recursive: true });
  return folder;
}

/**
 * The name a document is shown under: the custom name when one was given,
 * otherwise the uploaded file's own name — with the original extension
 * appended when the custom name lacks one.
 *
 * Deliberately independent of what is already on disk. The display name is
 * what the user typed (or uploaded); collision handling belongs to
 * `resolveUniqueName` and must never leak back into it, or replacing a file
 * with a new version of itself would rename the document to "foo (1).ext"
 * merely because the file being replaced is still on disk at that moment.
 */
export function resolveDisplayName(
  desiredName: string | undefined,
  originalName: string,
): string {
  const base = sanitizeSegment((desiredName ?? '').trim() || originalName);
  const originalExt = path.extname(originalName);

  // Ensure a custom name keeps a sensible extension.
  if (path.extname(base) === '' && originalExt) return base + originalExt;
  return base;
}

/**
 * Resolve the final on-disk file name inside `dirAbs` for a document with this
 * display name. Appends " (n)" if a file with that name already exists so
 * nothing is overwritten — which is also what keeps copy-on-write copies
 * beside the file they replace. Only the STORED name is suffixed; see
 * `resolveDisplayName`.
 */
export function resolveUniqueName(dirAbs: string, displayName: string): string {
  const ext = path.extname(displayName);
  const stem = displayName.slice(0, displayName.length - ext.length) || displayName;

  let candidate = displayName;
  let counter = 1;
  while (fs.existsSync(path.join(dirAbs, candidate))) {
    candidate = `${stem} (${counter})${ext}`;
    counter += 1;
  }
  return candidate;
}

/** A file moved into place on disk, not yet recorded in the database. */
export interface PlacedFile {
  /** Path relative to `documentsDir` — becomes `stored_files.storage_key`.
   *  May carry a " (n)" suffix to avoid overwriting a neighbouring file. */
  storageKey: string;
  /** The name shown to users — becomes the document row's `original_name`.
   *  Never suffixed: two revisions may legitimately show the same name. */
  displayName: string;
}

/**
 * Move an uploaded temp file into `folder`, naming it from the custom name (if
 * provided) or the original name.
 *
 * The two names are resolved separately on purpose — this is the whole reason
 * `stored_files.storage_key` and `original_name` are distinct columns.
 */
export function placeUpload(
  file: Express.Multer.File,
  folder: string,
  customName: string | undefined,
): PlacedFile {
  const dirAbs = path.join(documentsDir, folder);
  if (!fs.existsSync(dirAbs)) fs.mkdirSync(dirAbs, { recursive: true });

  const displayName = resolveDisplayName(customName, file.originalname);
  const storedName = resolveUniqueName(dirAbs, displayName);
  fs.renameSync(file.path, path.join(dirAbs, storedName));

  return { storageKey: `${folder}/${storedName}`, displayName };
}

/** Public URL for a stored file, encoded per segment so spaces resolve. */
export function publicPath(storageKey: string): string {
  const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
  return `/uploads/documents/${encoded}`;
}

/**
 * Absolute path of a stored file, or null if the key would escape the
 * documents folder. Storage keys are written by this service rather than by
 * users, so this is belt-and-braces — but it is the one place a bad key could
 * turn into an arbitrary file read, so it is checked before every download.
 */
export function resolveStoredFilePath(storageKey: string): string | null {
  const absolute = path.resolve(documentsDir, storageKey);
  const root = path.resolve(documentsDir);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/** The extension of a file name, lowercased and dot-prefixed ('.zip'). */
export function fileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

/** Delete a file if it is still there; a missing file is not an error. */
export function safeUnlink(absPath: string): void {
  if (!fs.existsSync(absPath)) return;
  try {
    fs.unlinkSync(absPath);
  } catch (err) {
    console.error(`Failed to unlink ${absPath}`, err);
  }
}

/**
 * Unlink a file that the reference check found to be unreferenced. Call only
 * AFTER the surrounding transaction has committed.
 */
export function unlinkStoredFile(storageKey: string | null): void {
  if (!storageKey) return;
  safeUnlink(path.join(documentsDir, storageKey));
}

// ── Stored files ───────────────────────────────────────────────────────────

/** Record a physical file in `stored_files` and return its id. */
export async function insertStoredFile(
  db: Queryable,
  input: { storageKey: string; sizeBytes: number; mimeType: string | null },
): Promise<number> {
  const result = await db.query<{ id: number }>(
    `INSERT INTO stored_files (storage_key, size_bytes, mime_type)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [input.storageKey, input.sizeBytes, input.mimeType],
  );
  return result.rows[0].id;
}

/**
 * Cleanup, plan §3.4: after a document row has stopped pointing at a stored
 * file, ask — statelessly, no counter to drift — whether ANY row still does.
 * If none does, the `stored_files` row is deleted and its storage key returned
 * so the caller can unlink the file post-commit. A file another revision still
 * shares yields `null` and survives untouched.
 *
 * Both document tables are checked: cheap (each `stored_file_id` column is
 * indexed) and immune to a stored file ever being shared across families.
 */
export async function releaseStoredFile(
  db: Queryable,
  storedFileId: number,
): Promise<string | null> {
  const referenced = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM product_revision_documents WHERE stored_file_id = $1
     UNION ALL
     SELECT 1 AS one FROM sub_product_revision_documents WHERE stored_file_id = $1
     LIMIT 1`,
    [storedFileId],
  );
  if ((referenced.rowCount ?? 0) > 0) return null;

  const deleted = await db.query<{ storage_key: string }>(
    `DELETE FROM stored_files WHERE id = $1 RETURNING storage_key`,
    [storedFileId],
  );
  return deleted.rows[0]?.storage_key ?? null;
}

// ── Entity / revision lookups ──────────────────────────────────────────────

/** The product / sub-product a revision belongs to, with the fields the
 *  folder name is built from. */
export interface DocumentEntity {
  id: number;
  name: string;
  sku: string | null;
}

/** Resolve a revision's owning entity, or null when the revision is unknown. */
export async function findEntityForRevision(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
): Promise<DocumentEntity | null> {
  const { revisionTable, entityTable, entityColumn } = SCOPES[scope];
  const result = await db.query<DocumentEntity>(
    `SELECT e.id, e.name, e.sku
     FROM ${revisionTable} r
     JOIN ${entityTable} e ON e.id = r.${entityColumn}
     WHERE r.id = $1`,
    [revisionId],
  );
  return result.rows[0] ?? null;
}

// ── Document type templates ────────────────────────────────────────────────

/** One per-type document requirement, as the panel renders it. */
export interface DocumentTypeTemplate {
  id: number;
  name: string;
  icon: string;
  allowed_extensions: string[];
  required: boolean;
}

// Requirements are defined per TYPE, and an entity names its type by string
// (`products.type` -> `product_types.name`), so reaching a revision's templates
// means revision -> entity -> type list -> templates.
function documentTypesQuery(scope: DocumentScope, extraFilter = ''): string {
  const { revisionTable, entityTable, entityColumn, typeTable, documentTypeTable, documentTypeColumn } =
    SCOPES[scope];
  return `
    SELECT dt.id, dt.name, dt.icon, dt.allowed_extensions, dt.required
    FROM ${revisionTable} r
    JOIN ${entityTable} e ON e.id = r.${entityColumn}
    JOIN ${typeTable} t ON t.name = e.type
    JOIN ${documentTypeTable} dt ON dt.${documentTypeColumn} = t.id
    WHERE r.id = $1 ${extraFilter}
    ORDER BY dt.sort_order ASC, dt.name ASC`;
}

/** Every document type defined for the type of this revision's entity. */
export async function listDocumentTypesForRevision(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
): Promise<DocumentTypeTemplate[]> {
  const result = await db.query<DocumentTypeTemplate>(documentTypesQuery(scope), [revisionId]);
  return result.rows;
}

/**
 * One document type, but only if it belongs to this revision's entity type —
 * so an upload naming a template from some other type is rejected rather than
 * silently filed under it. Null means "not a valid card for this revision".
 */
export async function findDocumentTypeForRevision(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
  documentTypeId: number,
): Promise<DocumentTypeTemplate | null> {
  const result = await db.query<DocumentTypeTemplate>(
    documentTypesQuery(scope, 'AND dt.id = $2'),
    [revisionId, documentTypeId],
  );
  return result.rows[0] ?? null;
}

// ── Carry-forward ──────────────────────────────────────────────────────────

/**
 * Which revision a newly created one inherits its documents from: the
 * explicitly duplicated revision when it really belongs to this entity,
 * otherwise the entity's most recent other revision. Returns null when there is
 * nothing to inherit.
 *
 * The ownership check matters — without it a caller could seed a new revision
 * with another product's documents by passing a foreign `duplicateFromId`.
 */
export async function resolveCarryForwardSource(
  db: Queryable,
  scope: DocumentScope,
  entityId: number,
  newRevisionId: number,
  duplicateFromId?: number | null,
): Promise<number | null> {
  const { revisionTable, entityColumn } = SCOPES[scope];

  if (duplicateFromId) {
    const owned = await db.query<{ id: number }>(
      `SELECT id FROM ${revisionTable} WHERE id = $1 AND ${entityColumn} = $2`,
      [duplicateFromId, entityId],
    );
    // An explicit source that isn't ours inherits nothing, rather than
    // silently falling back to a different revision than the caller asked for.
    return owned.rows[0]?.id ?? null;
  }

  const previous = await db.query<{ id: number }>(
    `SELECT id FROM ${revisionTable}
     WHERE ${entityColumn} = $1 AND id <> $2
     ORDER BY revision_number DESC, id DESC
     LIMIT 1`,
    [entityId, newRevisionId],
  );
  return previous.rows[0]?.id ?? null;
}

/**
 * Carry-forward, plan §3.4: point the new revision's documents at the SAME
 * stored files as the source revision. Rows are copied; no bytes are written,
 * so an unchanged file is stored exactly once no matter how many revisions use
 * it. Returns how many documents were inherited.
 */
export async function carryForwardDocuments(
  db: Queryable,
  scope: DocumentScope,
  fromRevisionId: number,
  toRevisionId: number,
): Promise<number> {
  const { table, revisionColumn } = SCOPES[scope];
  const result = await db.query<never>(
    `INSERT INTO ${table}
       (${revisionColumn}, document_type_id, stored_file_id, original_name, uploaded_by)
     SELECT $1, document_type_id, stored_file_id, original_name, uploaded_by
     FROM ${table}
     WHERE ${revisionColumn} = $2`,
    [toRevisionId, fromRevisionId],
  );
  return result.rowCount ?? 0;
}

/**
 * Convenience wrapper for the two "create a revision" endpoints: resolve the
 * source revision and inherit its documents in one call.
 */
export async function carryForwardOnNewRevision(
  db: Queryable,
  scope: DocumentScope,
  entityId: number,
  newRevisionId: number,
  duplicateFromId?: number | null,
): Promise<number> {
  const sourceId = await resolveCarryForwardSource(
    db,
    scope,
    entityId,
    newRevisionId,
    duplicateFromId,
  );
  if (sourceId == null) return 0;
  return carryForwardDocuments(db, scope, sourceId, newRevisionId);
}

// ── Document rows ──────────────────────────────────────────────────────────

/** One document row as stored, before it is shaped for an API response. */
export interface DocumentRow {
  id: number;
  document_type_id: number | null;
  original_name: string;
  storage_key: string;
  mime_type: string | null;
  size_bytes: string;
  created_at: Date;
}

/** All documents of one revision, newest first. */
export async function listDocuments(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
): Promise<DocumentRow[]> {
  const { table, revisionColumn } = SCOPES[scope];
  const result = await db.query<DocumentRow>(
    `SELECT d.id, d.document_type_id, d.original_name, d.created_at,
       sf.storage_key, sf.mime_type, sf.size_bytes
     FROM ${table} d
     JOIN stored_files sf ON sf.id = d.stored_file_id
     WHERE d.${revisionColumn} = $1
     ORDER BY d.created_at DESC, d.id DESC`,
    [revisionId],
  );
  return result.rows;
}

/** One document by id, for the download endpoints. Null when unknown. */
export async function findDocument(
  db: Queryable,
  scope: DocumentScope,
  docId: number,
): Promise<DocumentRow | null> {
  const { table } = SCOPES[scope];
  const result = await db.query<DocumentRow>(
    `SELECT d.id, d.document_type_id, d.original_name, d.created_at,
       sf.storage_key, sf.mime_type, sf.size_bytes
     FROM ${table} d
     JOIN stored_files sf ON sf.id = d.stored_file_id
     WHERE d.id = $1`,
    [docId],
  );
  return result.rows[0] ?? null;
}

/** Insert a document row pointing at an already-stored file. */
export async function insertDocument(
  db: Queryable,
  scope: DocumentScope,
  input: {
    revisionId: number;
    storedFileId: number;
    originalName: string;
    documentTypeId?: number | null;
    uploadedBy?: number | null;
  },
): Promise<DocumentRow> {
  const { table, revisionColumn } = SCOPES[scope];
  const result = await db.query<DocumentRow>(
    `WITH inserted AS (
       INSERT INTO ${table}
         (${revisionColumn}, document_type_id, stored_file_id, original_name, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, document_type_id, stored_file_id, original_name, created_at
     )
     SELECT i.id, i.document_type_id, i.original_name, i.created_at,
       sf.storage_key, sf.mime_type, sf.size_bytes
     FROM inserted i
     JOIN stored_files sf ON sf.id = i.stored_file_id`,
    [
      input.revisionId,
      input.documentTypeId ?? null,
      input.storedFileId,
      input.originalName,
      input.uploadedBy ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Copy-on-write, plan §3.4: repoint one revision's document row at a newly
 * stored file. The previously referenced file is never mutated — any other
 * revision sharing it keeps seeing exactly the bytes it had — and is released
 * only if this row was the last thing pointing at it.
 *
 * Returns the updated row plus the storage key of a now-orphaned old file for
 * the caller to unlink after commit (`null` when the old file is still shared).
 */
export async function repointDocument(
  db: Queryable,
  scope: DocumentScope,
  input: {
    revisionId: number;
    docId: number;
    storedFileId: number;
    originalName: string;
  },
): Promise<{ row: DocumentRow; orphanKey: string | null } | null> {
  const { table, revisionColumn } = SCOPES[scope];

  // Read the row first — UPDATE ... RETURNING would only give the NEW
  // stored_file_id, and the old one is what the cleanup check needs. FOR UPDATE
  // holds it for the transaction so two concurrent replaces of the same
  // document can't both try to release the same file.
  const existing = await db.query<{ stored_file_id: number }>(
    `SELECT stored_file_id FROM ${table}
     WHERE id = $1 AND ${revisionColumn} = $2
     FOR UPDATE`,
    [input.docId, input.revisionId],
  );
  if (existing.rowCount === 0) return null;
  const previousStoredFileId = existing.rows[0].stored_file_id;

  const updated = await db.query<DocumentRow>(
    `UPDATE ${table} d
     SET stored_file_id = $1, original_name = $2
     FROM stored_files sf
     WHERE d.id = $3 AND sf.id = $1
     RETURNING d.id, d.document_type_id, d.original_name, d.created_at,
       sf.storage_key, sf.mime_type, sf.size_bytes`,
    [input.storedFileId, input.originalName, input.docId],
  );

  return {
    row: updated.rows[0],
    orphanKey: await releaseStoredFile(db, previousStoredFileId),
  };
}

/**
 * Delete one revision's document row and run the cleanup check on the file it
 * pointed at. Returns `found: false` when the row does not belong to that
 * revision, and an `orphanKey` for the caller to unlink after commit when the
 * file is now unreferenced.
 */
export async function deleteDocument(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
  docId: number,
): Promise<{ found: boolean; orphanKey: string | null }> {
  const { table, revisionColumn } = SCOPES[scope];
  const deleted = await db.query<{ stored_file_id: number }>(
    `DELETE FROM ${table}
     WHERE id = $1 AND ${revisionColumn} = $2
     RETURNING stored_file_id`,
    [docId, revisionId],
  );
  if (deleted.rowCount === 0) return { found: false, orphanKey: null };

  return {
    found: true,
    orphanKey: await releaseStoredFile(db, deleted.rows[0].stored_file_id),
  };
}
