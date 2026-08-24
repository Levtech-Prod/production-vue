// ===========================================================================
// Document revisions — the versions a revision-mode document type holds.
// ---------------------------------------------------------------------------
// Deliberately much thinner than `documentFiles.ts`. Documents are pointers
// into a shared `stored_files` table because revisions carry files forward and
// replace them copy-on-write; a version's files have neither behaviour — they
// belong to one version of one card — so a file row owns its bytes outright
// and deleting it just unlinks them.
//
// The one rule that carries over: an unlink cannot be rolled back, so nothing
// here touches the disk on behalf of a transaction. Callers unlink AFTER their
// transaction commits.
// ===========================================================================
import fs from 'fs';
import path from 'path';
import type { Queryable } from '../db.js';
import {
  documentsDirFor,
  ensureDocumentRevisionDir,
  findEntityDir,
  productsDir,
  removeDocumentRevisionDirs,
  resolveDisplayName,
  resolveUnderProducts,
  safeUnlink,
  type FolderEntity,
} from './uploadPaths.js';
import {
  resolveEntityDocumentsDir,
  type DocumentEntity,
  type DocumentScope,
} from './documentFiles.js';

interface ScopeConfig {
  /** Document requirement templates for this family. */
  typeTable: string;
  /** The template table's FK column back to a single entity (migration 016). */
  typeEntityColumn: string;
  /** The owning entity's table (products / sub_products). */
  entityTable: string;
  /** `document_revisions`' FK column for this family. */
  revisionColumn: string;
}

// Table and column names are read only from this literal map — never from
// request input — so interpolating them into SQL is safe. All *values* stay
// parameterized.
const SCOPES: Record<DocumentScope, ScopeConfig> = {
  product: {
    typeTable: 'product_document_types',
    typeEntityColumn: 'product_id',
    entityTable: 'products',
    revisionColumn: 'product_document_type_id',
  },
  subProduct: {
    typeTable: 'sub_product_document_types',
    typeEntityColumn: 'sub_product_id',
    entityTable: 'sub_products',
    revisionColumn: 'sub_product_document_type_id',
  },
};

/** Which of `document_revisions`' two mutually exclusive FKs a family uses. */
export function revisionColumnFor(scope: DocumentScope): string {
  return SCOPES[scope].revisionColumn;
}

/** The card's own table, for the row lock that serialises promotions. */
export function documentTypeTableFor(scope: DocumentScope): string {
  return SCOPES[scope].typeTable;
}

/** Everything a document-revision request needs about what it is acting on. */
export interface RevisionOwner {
  scope: DocumentScope;
  documentTypeId: number;
  documentTypeName: string;
  /** Empty means the card takes ANY extension. Safe here in a way it is not
   *  for documents: version files are never statically served. */
  allowedExtensions: string[];
  revisionMode: boolean;
  /** The owning product / sub-product, in the shape the folder helpers want. */
  entity: DocumentEntity;
}

interface OwnerRow {
  document_type_name: string;
  allowed_extensions: string[] | null;
  revision_mode: boolean;
  entity_id: number;
  entity_name: string;
  entity_sku: string | null;
  product_id: number | null;
  product_name: string | null;
  product_sku: string | null;
}

function ownerQuery(scope: DocumentScope): string {
  const { typeTable, typeEntityColumn, entityTable } = SCOPES[scope];
  // A sub-product's folder lives inside its owning product's, so the parent's
  // name and SKU are needed to build the path. The product scope's entity IS
  // the product and has no parent to join.
  const parentJoin =
    scope === 'subProduct'
      ? 'LEFT JOIN products p ON p.id = e.product_id'
      : 'LEFT JOIN products p ON FALSE';

  return `
    SELECT dt.name AS document_type_name, dt.allowed_extensions, dt.revision_mode,
           e.id AS entity_id, e.name AS entity_name, e.sku AS entity_sku,
           p.id AS product_id, p.name AS product_name, p.sku AS product_sku
      FROM ${typeTable} dt
      JOIN ${entityTable} e ON e.id = dt.${typeEntityColumn}
      ${parentJoin}
     WHERE dt.id = $1`;
}

/**
 * Resolve the card a version belongs to, and through it the product /
 * sub-product that owns the folder tree and the change log.
 *
 * Null when the id is unknown OR when the template is type-scoped: a
 * type-scoped card is shared by every product of that type and so owns no
 * version history (see the scope CHECK in migration 022). Callers treat both
 * as "not a versioned card".
 */
export async function findRevisionOwnerByType(
  db: Queryable,
  scope: DocumentScope,
  documentTypeId: number,
): Promise<RevisionOwner | null> {
  const result = await db.query<OwnerRow>(ownerQuery(scope), [documentTypeId]);
  const row = result.rows[0];
  if (!row) return null;

  return {
    scope,
    documentTypeId,
    documentTypeName: row.document_type_name,
    allowedExtensions: row.allowed_extensions ?? [],
    revisionMode: row.revision_mode,
    entity: {
      id: row.entity_id,
      name: row.entity_name,
      sku: row.entity_sku,
      product:
        row.product_id === null
          ? null
          : { id: row.product_id, name: row.product_name ?? '', sku: row.product_sku },
    },
  };
}

/**
 * The same owner reached from a version id, plus the version's own name.
 *
 * Two round trips rather than one query with five LEFT JOINs across both
 * families: this is an admin-rate path, and the join version was unreadable.
 */
export async function findRevisionOwner(
  db: Queryable,
  revisionId: number,
): Promise<(RevisionOwner & { revisionName: string }) | null> {
  const result = await db.query<{
    name: string;
    product_document_type_id: number | null;
    sub_product_document_type_id: number | null;
  }>(
    `SELECT name, product_document_type_id, sub_product_document_type_id
       FROM document_revisions WHERE id = $1`,
    [revisionId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const scope: DocumentScope = row.product_document_type_id === null ? 'subProduct' : 'product';
  const typeId = row.product_document_type_id ?? row.sub_product_document_type_id;
  if (typeId === null) return null;

  const owner = await findRevisionOwnerByType(db, scope, typeId);
  return owner ? { ...owner, revisionName: row.name } : null;
}

/** The main product a card's versions belong to: the entity the change log is
 *  keyed on, and whose folder tree holds the files. Null only for a sub-product
 *  with no parent, which predates migration 014. */
export function ownerProduct(owner: RevisionOwner): FolderEntity | null {
  return owner.scope === 'product' ? owner.entity : owner.entity.product;
}

/** How the panel summarises a revision-mode card without loading its versions. */
export interface RevisionTypeStats {
  versionCount: number;
  /** Name of the card's production version, if it has one. */
  productionName: string | null;
  /** Whether that production version actually carries a file. This, not the
   *  version count, is what satisfies the card: a version with nothing attached
   *  is a placeholder, and a card whose testing versions have files but whose
   *  production one does not still has nothing to ship. */
  productionHasFiles: boolean;
}

/** One grouped summary per card, for the panel payload. */
export async function listRevisionStats(
  db: Queryable,
  scope: DocumentScope,
  documentTypeIds: number[],
): Promise<Map<number, RevisionTypeStats>> {
  if (documentTypeIds.length === 0) return new Map();
  const column = SCOPES[scope].revisionColumn;

  const result = await db.query<{
    document_type_id: number;
    version_count: number;
    production_name: string | null;
    production_has_files: boolean;
  }>(
    // `bool_or` over a per-row EXISTS rather than a join: joining the files in
    // would multiply the rows and break the version count in the same query.
    // At most one row per card can be `production`, so the OR collapses to it.
    `SELECT dr.${column} AS document_type_id,
            COUNT(*)::int AS version_count,
            MAX(dr.name) FILTER (WHERE dr.status = 'production') AS production_name,
            COALESCE(
              bool_or(
                dr.status = 'production'
                AND EXISTS (SELECT 1 FROM document_revision_files f
                             WHERE f.document_revision_id = dr.id)
              ),
              FALSE
            ) AS production_has_files
       FROM document_revisions dr
      WHERE dr.${column} = ANY($1::int[])
      GROUP BY dr.${column}`,
    [documentTypeIds],
  );

  return new Map(
    result.rows.map((row) => [
      row.document_type_id,
      {
        versionCount: row.version_count,
        productionName: row.production_name,
        productionHasFiles: row.production_has_files,
      },
    ]),
  );
}

/** How many versions a card holds — what stops revision mode being switched
 *  off under them. */
export async function countRevisions(
  db: Queryable,
  scope: DocumentScope,
  documentTypeId: number,
): Promise<number> {
  const column = SCOPES[scope].revisionColumn;
  const result = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM document_revisions WHERE ${column} = $1`,
    [documentTypeId],
  );
  return result.rows[0].count;
}

/**
 * The storage keys of the files belonging to these versions. Read INSIDE the
 * deleting transaction, before the cascade takes the rows away.
 *
 * The keys, not the folders, are what locate the bytes: files migrated from the
 * old firmware feature kept their original `documents/firmware/{oldId}-{ver}/`
 * path (migration 022), so a scan of `documents/revisions/` keyed on the new
 * version id finds nothing and would leak them.
 */
export async function listRevisionFileKeys(
  db: Queryable,
  revisionIds: readonly number[],
): Promise<string[]> {
  if (revisionIds.length === 0) return [];
  const result = await db.query<{ storage_key: string }>(
    `SELECT storage_key FROM document_revision_files
      WHERE document_revision_id = ANY($1::int[])`,
    [revisionIds],
  );
  return result.rows.map((row) => row.storage_key);
}

/** Every version id a card holds, so their folders can be removed after the
 *  cascade that deletes the card has committed. */
export async function listRevisionIds(
  db: Queryable,
  scope: DocumentScope,
  documentTypeId: number,
): Promise<number[]> {
  const column = SCOPES[scope].revisionColumn;
  const result = await db.query<{ id: number }>(
    `SELECT id FROM document_revisions WHERE ${column} = $1`,
    [documentTypeId],
  );
  return result.rows.map((row) => row.id);
}

// ── Filesystem ─────────────────────────────────────────────────────────────

/** A version file moved into place, not yet recorded in the database. */
export interface PlacedRevisionFile {
  /** Path relative to `productsDir` — becomes `storage_key`. */
  storageKey: string;
  /** The name shown to users. The custom name when one was given, otherwise
   *  the uploaded file's own. */
  originalName: string;
}

/** A version's own folder, relative to `productsDir` — created if missing. */
export function ensureRevisionDir(
  owner: RevisionOwner,
  revision: { id: number; name: string },
): string {
  return ensureDocumentRevisionDir(resolveEntityDocumentsDir(owner.entity), revision);
}

/**
 * Move an uploaded temp file into `folder` (relative to `productsDir`, from
 * `ensureRevisionDir`) under its display name.
 *
 * Takes the resolved folder rather than resolving it, mirroring `placeUpload`
 * in documentFiles.ts: resolution walks and creates several directory levels,
 * and one request may carry twenty files into the same folder.
 *
 * Unlike a document, a same-named file is OVERWRITTEN rather than given a
 * " (n)" suffix: re-uploading `firmware.hex` means a new build of the same
 * artifact, and two near-identical names in the file list is worse than losing
 * the superseded copy. That makes the storage key a pure function of the
 * version and the file name, which is what lets the insert upsert on it.
 */
export function placeRevisionFile(
  file: Express.Multer.File,
  folder: string,
  customName?: string,
): PlacedRevisionFile {
  const dirAbs = path.join(productsDir, folder);
  // The same rule documents use: the extension always comes from the uploaded
  // file, appended rather than substituted when a custom name carries a
  // different one. Here it also decides the storage key, so a renamed upload no
  // longer overwrites the file it was renamed from.
  const originalName = resolveDisplayName(customName, file.originalname);
  fs.renameSync(file.path, path.join(dirAbs, originalName));

  return { storageKey: `${folder}/${originalName}`, originalName };
}

/**
 * Unlink the given files and then remove the versions' own folders. Call only
 * AFTER the deleting transaction has committed — neither can be rolled back.
 *
 * Both steps are needed: the keys cover files wherever they sit (including the
 * migrated `documents/firmware/...` ones), the folder sweep clears the now-empty
 * `documents/revisions/{id}-{name}` directories the keys leave behind.
 */
export function removeRevisionFiles(
  owner: RevisionOwner,
  revisionIds: readonly number[],
  storageKeys: readonly string[],
): void {
  for (const key of storageKeys) unlinkRevisionFile(key);
  removeRevisionDirs(owner, revisionIds);
}

function removeRevisionDirs(
  owner: RevisionOwner,
  revisionIds: readonly number[],
): void {
  const product = ownerProduct(owner);
  if (!product) return;
  const entityDir =
    owner.scope === 'product' ? findEntityDir(product) : findEntityDir(product, owner.entity);
  if (!entityDir) return;
  removeDocumentRevisionDirs(documentsDirFor(entityDir), revisionIds);
}

/** Absolute path of a version file, or null if the key would escape the tree.
 *  Keys are relative to `productsDir`, exactly like a document's. */
export function resolveRevisionFilePath(storageKey: string): string | null {
  return resolveUnderProducts(storageKey);
}

/** Unlink a version file by storage key. Call only AFTER the surrounding
 *  transaction has committed. */
export function unlinkRevisionFile(storageKey: string | null): void {
  if (!storageKey) return;
  const absolute = resolveUnderProducts(storageKey);
  if (absolute) safeUnlink(absolute);
}
