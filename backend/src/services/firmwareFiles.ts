// ===========================================================================
// Firmware storage (see migration 019).
// ---------------------------------------------------------------------------
// Deliberately much thinner than `documentFiles.ts`. Documents are pointers
// into a shared `stored_files` table because revisions carry files forward and
// replace them copy-on-write; firmware has neither behaviour — a build
// artifact belongs to one firmware of one revision — so a file row owns its
// bytes outright and deleting it just unlinks them.
//
// The one rule that carries over: an unlink cannot be rolled back, so nothing
// here touches the disk on behalf of a transaction. Callers unlink AFTER their
// transaction commits.
// ===========================================================================
import fs from 'fs';
import path from 'path';
import type { Queryable } from '../db.js';
import {
  clampFileName,
  productsDir,
  resolveUnderProducts,
  safeUnlink,
  sanitizeSegment,
  type FolderEntity,
} from './uploadPaths.js';

/**
 * Everything a firmware request needs about what it is acting on: the owning
 * sub-product (for the folder path), the revision (for the audit trail) and
 * the main product, which is the entity the product change log is keyed on.
 */
export interface FirmwareContext {
  subProduct: FolderEntity;
  /** The owning main product — the firmware folder lives inside its tree, so
   *  its name and SKU are needed to build the path. Null only for a
   *  sub-product with no parent, which predates migration 014. */
  product: FolderEntity | null;
  revisionId: number;
  revisionLabel: string;
}

const CONTEXT_COLUMNS = `
  sp.id AS "subProductId", sp.name AS "subProductName", sp.sku AS "subProductSku",
  p.id AS "productId", p.name AS "productName", p.sku AS "productSku",
  spr.id AS "revisionId", spr.label AS "revisionLabel"`;

/** The joins `CONTEXT_COLUMNS` reads from, minus the WHERE clause. */
const CONTEXT_FROM = `
  FROM sub_product_revisions spr
  JOIN sub_products sp ON sp.id = spr.sub_product_id
  LEFT JOIN products p ON p.id = sp.product_id`;

interface ContextRow {
  subProductId: number;
  subProductName: string;
  subProductSku: string | null;
  productId: number | null;
  productName: string | null;
  productSku: string | null;
  revisionId: number;
  revisionLabel: string;
}

function toContext(row: ContextRow): FirmwareContext {
  return {
    subProduct: { id: row.subProductId, name: row.subProductName, sku: row.subProductSku },
    product:
      row.productId === null
        ? null
        : { id: row.productId, name: row.productName ?? '', sku: row.productSku },
    revisionId: row.revisionId,
    revisionLabel: row.revisionLabel,
  };
}

/**
 * Resolve a sub-product revision, confirming it really belongs to `spId` — a
 * valid revision id under the wrong parent must be a 404, not a cross-read.
 */
export async function findRevisionContext(
  db: Queryable,
  spId: number,
  revId: number,
): Promise<FirmwareContext | null> {
  const result = await db.query<ContextRow>(
    `SELECT ${CONTEXT_COLUMNS} ${CONTEXT_FROM}
      WHERE spr.id = $1 AND spr.sub_product_id = $2`,
    [revId, spId],
  );
  const row = result.rows[0];
  return row ? toContext(row) : null;
}

/** The same context reached from a firmware id, plus the firmware's own name. */
export async function findFirmwareContext(
  db: Queryable,
  firmwareId: number,
): Promise<(FirmwareContext & { firmwareName: string }) | null> {
  const result = await db.query<ContextRow & { firmwareName: string }>(
    `SELECT ${CONTEXT_COLUMNS}, f.name AS "firmwareName"
       ${CONTEXT_FROM}
       JOIN firmwares f ON f.sub_product_revision_id = spr.id
      WHERE f.id = $1`,
    [firmwareId],
  );
  const row = result.rows[0];
  return row ? { ...toContext(row), firmwareName: row.firmwareName } : null;
}

/** A firmware file moved into place, not yet recorded in the database. */
export interface PlacedFirmwareFile {
  /** Path relative to `firmwareDir` — becomes `firmware_files.storage_key`. */
  storageKey: string;
  /** The name shown to users — becomes `firmware_files.original_name`. */
  originalName: string;
}

/**
 * Move an uploaded temp file into `folder` (relative to `productsDir`, from
 * `ensureFirmwareDir`) under its own name.
 *
 * Takes the resolved folder rather than resolving it, mirroring `placeUpload`
 * in documentFiles.ts: resolution walks and creates three directory levels,
 * and one request may carry twenty files into the same folder.
 *
 * Unlike documents, a same-named file is OVERWRITTEN rather than given a
 * " (n)" suffix: re-uploading `firmware.hex` means a new build of the same
 * artifact, and two near-identical names in the file list is worse than
 * losing the superseded copy. That makes the storage key a pure function of
 * the firmware and the file name, which is what lets the insert upsert on it.
 */
export function placeFirmwareFile(
  file: Express.Multer.File,
  folder: string,
): PlacedFirmwareFile {
  const dirAbs = path.join(productsDir, folder);
  const originalName = clampFileName(sanitizeSegment(file.originalname));
  fs.renameSync(file.path, path.join(dirAbs, originalName));

  return { storageKey: `${folder}/${originalName}`, originalName };
}

/** Absolute path of a firmware file, or null if the key would escape the tree.
 *  Keys are relative to `productsDir`, exactly like a document's. */
export function resolveFirmwareFilePath(storageKey: string): string | null {
  return resolveUnderProducts(storageKey);
}

/**
 * Unlink a firmware file by storage key. Call only AFTER the surrounding
 * transaction has committed.
 */
export function unlinkFirmwareFile(storageKey: string | null): void {
  if (!storageKey) return;
  const absolute = resolveUnderProducts(storageKey);
  if (absolute) safeUnlink(absolute);
}
