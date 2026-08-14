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
import type { Queryable } from '../db.js';
import {
  documentsDirFor,
  ensureProductDir,
  ensureSubProductDir,
  findEntityDir,
  productsDir,
  PUBLIC_PREFIX,
  resolveDisplayName,
  resolveUnderProducts,
  safeUnlink,
  type FolderEntity,
} from './uploadPaths.js';

export { resolveDisplayName };

// Re-exported so the many modules that already import their DB plumbing from
// this service keep one import site.
export { safeUnlink };
export type { Queryable };

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
  /** Document requirement templates. */
  documentTypeTable: string;
  /** The template table's FK column back to the type list. */
  documentTypeColumn: string;
  /** The template table's FK column back to a single entity (migration 016). */
  documentTypeEntityColumn: string;
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
    documentTypeEntityColumn: 'product_id',
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
    documentTypeEntityColumn: 'sub_product_id',
  },
};

// ── Filesystem ─────────────────────────────────────────────────────────────

/**
 * The `documents/` folder holding every document of one product / sub-product
 * — across ALL of its revisions, which is what lets revisions share a file
 * without duplicating it (plan §3.2). Returned relative to `productsDir`.
 *
 * Revision-independent by design: a revision folder would force a physical copy
 * per revision and destroy the pointer model.
 */
export function resolveEntityDocumentsDir(entity: DocumentEntity): string {
  const entityDir =
    entity.product === null
      ? ensureProductDir(entity)
      : ensureSubProductDir(entity.product, entity);
  return documentsDirFor(entityDir);
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
  /** Path relative to `productsDir` — becomes `stored_files.storage_key`.
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
  const dirAbs = path.join(productsDir, folder);
  if (!fs.existsSync(dirAbs)) fs.mkdirSync(dirAbs, { recursive: true });

  const displayName = resolveDisplayName(customName, file.originalname);
  const storedName = resolveUniqueName(dirAbs, displayName);
  fs.renameSync(file.path, path.join(dirAbs, storedName));

  return { storageKey: `${folder}/${storedName}`, displayName };
}

/** Public URL for a stored file, encoded per segment so spaces resolve. */
export function publicPath(storageKey: string): string {
  const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
  return `${PUBLIC_PREFIX}/${encoded}`;
}

/** Absolute path of a stored file, or null if the key would escape the tree. */
export function resolveStoredFilePath(storageKey: string): string | null {
  return resolveUnderProducts(storageKey);
}

/** The extension of a file name, lowercased and dot-prefixed ('.zip'). */
export function fileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

// The upload gate is the file EXTENSION, not the MIME type (plan §7.4):
// engineering formats mostly have no registered MIME, so browsers send them as
// application/octet-stream and a MIME allow-list would either reject every
// .step file or have to admit octet-stream and stop meaning anything.
//
// Single source of truth, shared by the multer filter in routes/documents.ts
// (what an upload may actually be) and the `allowedExtensions` validation in
// schemas/documentTypes.schema.ts (what an admin may configure a card to
// accept) — a document type's own list only narrows this, so a card can never
// be configured to accept an extension the upload endpoint would reject.
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  // Documents and data
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.json', '.xml', '.log',
  // Images (no .svg — it is scriptable and we serve uploads statically)
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  // Archives
  '.zip', '.rar', '.7z', '.gz', '.tar',
  // Mechanical CAD / CAM
  '.step', '.stp', '.iges', '.igs', '.stl', '.dxf', '.dwg',
  '.sldprt', '.sldasm', '.ipt', '.iam', '.f3d', '.3mf', '.obj',
  '.nc', '.tap', '.gcode', '.cnc',
  // Electronics CAD / fabrication
  '.gbr', '.gbl', '.gtl', '.gbs', '.gts', '.gbo', '.gto', '.gko', '.gtd',
  '.drl', '.xln', '.gerber',
  '.pcbdoc', '.schdoc', '.prjpcb', '.sch', '.brd', '.kicad_pcb', '.kicad_sch',
  // Firmware
  '.hex', '.elf', '.bin', '.map', '.s19', '.srec', '.uf2', '.dfu',
  // Vector graphics / packaging design
  '.cdr', '.art',
]);

/**
 * Unlink a file that the reference check found to be unreferenced. Call only
 * AFTER the surrounding transaction has committed.
 */
export function unlinkStoredFile(storageKey: string | null): void {
  if (!storageKey) return;
  safeUnlink(path.join(productsDir, storageKey));
}

/**
 * Remove an entity's whole folder — its image, its documents, and for a product
 * its sub-products' folders too. Call only AFTER the deleting transaction has
 * committed, for the same reason `unlinkStoredFile` is post-commit: an `rm`
 * cannot be rolled back.
 */
export function removeEntityFolder(entity: DocumentEntity): void {
  // Deliberately the non-creating lookup: an entity that never had an upload
  // has no folder, and `ensure*` would create it (and its parent) just to
  // delete it again.
  const entityDir =
    entity.product === null
      ? findEntityDir(entity)
      : findEntityDir(entity.product, entity);
  if (!entityDir) return;

  fs.rmSync(path.join(productsDir, entityDir), { recursive: true, force: true });
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
 *
 * MUST be called inside the caller's transaction — `db` is a tx client, never
 * the pool. The row lock below is what makes the check correct, and a lock
 * taken in autocommit is released before it can do any good.
 */
export async function releaseStoredFile(
  db: Queryable,
  storedFileId: number,
): Promise<string | null> {
  // Serialise every release of THIS file before asking the question.
  //
  // Without the lock, two transactions each deleting a different row that
  // shares the file both answer "no" and both leak it: under READ COMMITTED
  // neither can see the other's uncommitted delete, so each still sees a row
  // it thinks needs the file, and the file is orphaned on disk with no
  // `stored_files` row left pointing at it. Holding the lock first makes the
  // second transaction wait; when it proceeds, its next statement gets a fresh
  // READ COMMITTED snapshot and sees the truth.
  //
  // The same lock closes the opposite race: inserting a document row that
  // references this file takes a FOR KEY SHARE lock on it, which conflicts
  // with FOR UPDATE. So a carry-forward that would adopt the file cannot slip
  // in between the check and the delete — it either lands first (and the check
  // sees it) or waits until we are done.
  const locked = await db.query<{ id: number }>(
    `SELECT id FROM stored_files WHERE id = $1 FOR UPDATE`,
    [storedFileId],
  );
  // Already released by a transaction that committed while we waited.
  if (locked.rowCount === 0) return null;

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

/**
 * The product / sub-product a revision belongs to, with the fields the folder
 * name is built from. `product` is the owning main product for a sub-product,
 * and null for a product — which is also what tells the path helpers which of
 * the two levels of the tree to build.
 */
export interface DocumentEntity extends FolderEntity {
  product: FolderEntity | null;
}

interface EntityRow extends FolderEntity {
  product_id: number | null;
  product_name: string | null;
  product_sku: string | null;
}

/** Resolve a revision's owning entity, or null when the revision is unknown. */
export async function findEntityForRevision(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
): Promise<DocumentEntity | null> {
  const { revisionTable, entityTable, entityColumn } = SCOPES[scope];

  // A sub-product's folder lives inside its owning product's, so the parent's
  // name and SKU are needed to build the path — hence the extra join, which is
  // a no-op for the product scope.
  const parentJoin =
    scope === 'subProduct'
      ? `LEFT JOIN products p ON p.id = e.product_id`
      : `LEFT JOIN products p ON FALSE`;

  const result = await db.query<EntityRow>(
    `SELECT e.id, e.name, e.sku,
       p.id AS product_id, p.name AS product_name, p.sku AS product_sku
     FROM ${revisionTable} r
     JOIN ${entityTable} e ON e.id = r.${entityColumn}
     ${parentJoin}
     WHERE r.id = $1`,
    [revisionId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    product:
      row.product_id === null
        ? null
        : { id: row.product_id, name: row.product_name ?? '', sku: row.product_sku },
  };
}

// ── Document type templates ────────────────────────────────────────────────

/** One document requirement, as the panel renders it. */
export interface DocumentTypeTemplate {
  id: number;
  name: string;
  icon: string;
  allowed_extensions: string[];
  required: boolean;
  /** Defined on this entity alone rather than inherited from its type — the
   *  only kind the panel lets an admin edit or delete in place. */
  custom: boolean;
}

// A revision's requirements are the union of two scopes (migration 016): those
// its entity inherits from its TYPE — named by string, `products.type` ->
// `product_types.name`, hence the join through the type list — and those
// defined on the entity itself. Exactly one of the two FKs is set per row, so
// the OR can never match a template twice.
//
// The type join is LEFT: an entity whose `type` no longer names a row in the
// managed list still has to show its own document types.
function documentTypesQuery(scope: DocumentScope, extraFilter = ''): string {
  const {
    revisionTable,
    entityTable,
    entityColumn,
    typeTable,
    documentTypeTable,
    documentTypeColumn,
    documentTypeEntityColumn,
  } = SCOPES[scope];
  return `
    SELECT dt.id, dt.name, dt.icon, dt.allowed_extensions, dt.required,
      dt.${documentTypeEntityColumn} IS NOT NULL AS custom
    FROM ${revisionTable} r
    JOIN ${entityTable} e ON e.id = r.${entityColumn}
    LEFT JOIN ${typeTable} t ON t.name = e.type
    JOIN ${documentTypeTable} dt
      ON dt.${documentTypeColumn} = t.id
      OR dt.${documentTypeEntityColumn} = e.id
    WHERE r.id = $1 ${extraFilter}
    ORDER BY custom ASC, dt.sort_order ASC, dt.name ASC`;
}

/** Every document type that applies to this revision's entity — inherited from
 *  its type, plus any defined on the entity itself. */
export async function listDocumentTypesForRevision(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
): Promise<DocumentTypeTemplate[]> {
  const result = await db.query<DocumentTypeTemplate>(documentTypesQuery(scope), [revisionId]);
  return result.rows;
}

/**
 * One document type, but only if it applies to this revision's entity — so an
 * upload naming a template from another type, or from another product, is
 * rejected rather than silently filed under it. Null means "not a valid card
 * for this revision".
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
 * Which revision a new one inherits its documents from. An id inherits from
 * that revision; `null` means the caller chose "no documents"; `undefined`
 * means it said nothing, so fall back to the previous revision. Null and
 * undefined must stay distinct, or "start empty" would copy the previous
 * revision anyway.
 *
 * The ownership check stops a foreign id seeding another product's documents.
 */
export async function resolveCarryForwardSource(
  db: Queryable,
  scope: DocumentScope,
  entityId: number,
  newRevisionId: number,
  duplicateFromId?: number | null,
): Promise<number | null> {
  const { revisionTable, entityColumn } = SCOPES[scope];

  if (duplicateFromId === null) return null;

  if (duplicateFromId !== undefined) {
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
 * Wrapper for the two "create a revision" endpoints. `documentsFromId` wins
 * when supplied, else `duplicateFromId` (older clients). Tested with
 * `!== undefined`, not `??`: an explicit null means "no documents".
 */
export async function carryForwardOnNewRevision(
  db: Queryable,
  scope: DocumentScope,
  entityId: number,
  newRevisionId: number,
  duplicateFromId?: number | null,
  documentsFromId?: number | null,
): Promise<number> {
  const source = documentsFromId !== undefined ? documentsFromId : duplicateFromId;
  const sourceId = await resolveCarryForwardSource(
    db,
    scope,
    entityId,
    newRevisionId,
    source,
  );
  if (sourceId == null) return 0;
  return carryForwardDocuments(db, scope, sourceId, newRevisionId);
}

// ── Linking an existing file into another revision ─────────────────────────
//
// The manual counterpart to carry-forward, by the same mechanism: a new
// document row over the same `stored_file_id`. Limited to one entity because a
// file lives in that entity's folder (plan §3.2); cross-entity sharing is the
// phase-2 hash-dedup case.

/** A document row being borrowed. */
export interface LinkSource {
  id: number;
  stored_file_id: number;
  original_name: string;
  document_type_id: number | null;
}

/** The source document for a link — null unless it sits on a different
 *  revision of the same entity as `targetRevisionId`. */
export async function findLinkSource(
  db: Queryable,
  scope: DocumentScope,
  targetRevisionId: number,
  docId: number,
): Promise<LinkSource | null> {
  const { table, revisionColumn, revisionTable, entityColumn } = SCOPES[scope];
  const result = await db.query<LinkSource>(
    `SELECT d.id, d.stored_file_id, d.original_name, d.document_type_id
     FROM ${table} d
     JOIN ${revisionTable} source ON source.id = d.${revisionColumn}
     JOIN ${revisionTable} target ON target.id = $1
     WHERE d.id = $2
       AND source.${entityColumn} = target.${entityColumn}
       AND source.id <> target.id`,
    [targetRevisionId, docId],
  );
  return result.rows[0] ?? null;
}

/** Guards against linking one file twice onto the same card, which would show
 *  two entries the user cannot tell apart. */
export async function isStoredFileLinked(
  db: Queryable,
  scope: DocumentScope,
  revisionId: number,
  storedFileId: number,
  documentTypeId: number | null,
): Promise<boolean> {
  const { table, revisionColumn } = SCOPES[scope];
  const result = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM ${table}
     WHERE ${revisionColumn} = $1
       AND stored_file_id = $2
       AND document_type_id IS NOT DISTINCT FROM $3
     LIMIT 1`,
    [revisionId, storedFileId, documentTypeId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** One borrowable document, with the revision it currently belongs to. */
export interface LinkableDocumentRow extends DocumentRow {
  revision_id: number;
  revision_label: string;
  revision_number: number;
  /** Already on the target revision — offered, but not selectable. */
  already_linked: boolean;
}

/**
 * Documents held by the entity's other revisions, newest first, for the picker.
 * Rows already on the target are flagged rather than filtered out — omitting
 * the file the user is looking for is more confusing than greying it out.
 */
export async function listLinkableDocuments(
  db: Queryable,
  scope: DocumentScope,
  targetRevisionId: number,
  documentTypeId: number | null,
): Promise<LinkableDocumentRow[]> {
  const { table, revisionColumn, revisionTable, entityColumn } = SCOPES[scope];
  const result = await db.query<LinkableDocumentRow>(
    `SELECT d.id, d.document_type_id, d.original_name, d.created_at,
       sf.storage_key, sf.mime_type, sf.size_bytes,
       source.id AS revision_id,
       source.label AS revision_label,
       source.revision_number,
       EXISTS (
         SELECT 1 FROM ${table} existing
         WHERE existing.${revisionColumn} = target.id
           AND existing.stored_file_id = d.stored_file_id
           AND existing.document_type_id IS NOT DISTINCT FROM $2
       ) AS already_linked
     FROM ${table} d
     JOIN stored_files sf ON sf.id = d.stored_file_id
     JOIN ${revisionTable} source ON source.id = d.${revisionColumn}
     JOIN ${revisionTable} target ON target.id = $1
     WHERE source.${entityColumn} = target.${entityColumn}
       AND source.id <> target.id
     ORDER BY source.revision_number DESC, d.created_at DESC, d.id DESC`,
    [targetRevisionId, documentTypeId],
  );
  return result.rows;
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
