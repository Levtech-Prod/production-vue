// ===========================================================================
// Where uploaded files live on disk (uploads-restructure-plan.md §2, §3).
//
// One folder per product, holding everything that belongs to it:
//
//   uploads/products/{id}-{Name}-{SKU}/
//     image-{ts}.{ext}
//     documents/
//     sub-products/{id}-{Name}-{SKU}/
//       image-{ts}.{ext}
//       documents/
//
// Folder names are built ONCE, at creation, and afterwards a folder is located
// by its immutable `{id}-` prefix — never by its full name. So renaming a
// product leaves the folder name stale on purpose and no `storage_key` ever
// has to be rewritten. `npm run uploads:resync-names` pays off the cosmetic
// drift in one deliberate batch.
//
// This module is the single source of truth for those rules: the service, the
// one-shot migration and the resync script all derive paths from here.
// ===========================================================================
import fs from 'fs';
import path from 'path';

const uploadsRoot = path.join(process.cwd(), 'uploads');

/** Root of the product-owned tree. */
export const productsDir = path.join(uploadsRoot, 'products');

/**
 * Staging area for files uploaded before their owner exists — a product image
 * is uploaded while the form is still open, and `products.image` is NOT NULL so
 * there is no row (and no id) to file it under yet.
 *
 * Under `uploads/`, so it IS statically served: the modal previews the image
 * from the URL the upload returned, before anything is submitted. Kept out of
 * `products/` so a half-finished upload is never mistaken for a real file by
 * the migration or the resync script. Contents are extension/MIME-filtered on
 * the way in, and swept after 24h.
 */
export const tmpDir = path.join(uploadsRoot, '_tmp');

/** `tmpDir`, created on demand. Multer needs the directory to already exist. */
export function ensureTmpDir(): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

/** Public URL prefix matching `express.static('/uploads')` in server.ts. */
export const PUBLIC_PREFIX = '/uploads/products';

/** The `_tmp` equivalent, as it appears in an `image` column mid-flight. */
export const TMP_PUBLIC_PREFIX = '/uploads/_tmp';

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
 * The folder name an entity would get if it were created now:
 * `{id}-{Name-with-dashes}` plus `-{SKU}` when it has one.
 *
 * Not the way to LOCATE an existing folder — use `findEntityFolder` for that,
 * since a folder's name may predate a rename. This is the canonical name that
 * new folders get and that `resync-upload-folder-names` compares against.
 */
export function canonicalFolderName(
  id: number,
  name: string,
  sku: string | null,
): string {
  const dashedName = name.replace(/\s+/g, '-');
  const suffix = sku ? `-${sku}` : '';
  return sanitizeSegment(`${id}-${dashedName}${suffix}`);
}

/** The id encoded in a folder name, or null when it does not carry one. */
function folderId(folderName: string): number | null {
  const match = /^(\d+)-/.exec(folderName);
  return match ? Number(match[1]) : null;
}

/** Subdirectory names of `absDir`; empty when it does not exist. */
export function directoriesIn(absDir: string): string[] {
  if (!fs.existsSync(absDir)) return [];
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * The existing folder for this entity inside `absParent`, matched on the
 * immutable `{id}-` prefix, or null when it has none yet.
 *
 * Sorted so that a duplicate — which the prefix rule is meant to make
 * impossible — resolves deterministically instead of by readdir order.
 */
export function findEntityFolder(absParent: string, entityId: number): string | null {
  return directoriesIn(absParent)
    .filter((name) => folderId(name) === entityId)
    .sort()[0] ?? null;
}

/**
 * Locate or create an entity's folder, returning its name (not a full path).
 * Reuses a folder with the same `{id}-` prefix whatever its name suffix, so a
 * rename can never fragment an entity into two folders.
 */
function ensureEntityFolder(
  absParent: string,
  entityId: number,
  name: string,
  sku: string | null,
): string {
  const existing = findEntityFolder(absParent, entityId);
  if (existing) return existing;

  const folder = canonicalFolderName(entityId, name, sku);
  fs.mkdirSync(path.join(absParent, folder), { recursive: true });
  return folder;
}

/** An entity identified well enough to build its folder name. */
export interface FolderEntity {
  id: number;
  name: string;
  sku: string | null;
}

/**
 * The product's folder, relative to `productsDir` — created if missing.
 */
export function ensureProductDir(product: FolderEntity): string {
  fs.mkdirSync(productsDir, { recursive: true });
  return ensureEntityFolder(productsDir, product.id, product.name, product.sku);
}

/**
 * A sub-product's folder, relative to `productsDir`, as
 * `{product}/sub-products/{sub}` — created if missing, parent included.
 */
export function ensureSubProductDir(
  product: FolderEntity,
  subProduct: FolderEntity,
): string {
  const productFolder = ensureProductDir(product);
  const subParentAbs = path.join(productsDir, productFolder, 'sub-products');
  fs.mkdirSync(subParentAbs, { recursive: true });
  const subFolder = ensureEntityFolder(
    subParentAbs,
    subProduct.id,
    subProduct.name,
    subProduct.sku,
  );
  return `${productFolder}/sub-products/${subFolder}`;
}

/**
 * An entity's folder relative to `productsDir`, or null when it has none —
 * the read-only counterpart to the `ensure*` pair above. Used where creating a
 * folder would be wrong, notably when deleting one.
 */
export function findEntityDir(
  product: FolderEntity,
  subProduct?: FolderEntity,
): string | null {
  const productFolder = findEntityFolder(productsDir, product.id);
  if (!productFolder) return null;
  if (!subProduct) return productFolder;

  const subParentAbs = path.join(productsDir, productFolder, 'sub-products');
  const subFolder = findEntityFolder(subParentAbs, subProduct.id);
  return subFolder ? `${productFolder}/sub-products/${subFolder}` : null;
}

/** The `documents/` folder inside an entity folder, relative to `productsDir`. */
export function documentsDirFor(entityDir: string): string {
  return `${entityDir}/documents`;
}

/**
 * Absolute path for `key` inside `rootAbs`, or null if it would escape. Keys
 * are written by the services rather than by users, so this is belt-and-braces
 * — but it is the one place a bad key could turn into an arbitrary file read,
 * so it is checked before every download.
 */
function resolveUnder(rootAbs: string, key: string): string | null {
  const absolute = path.resolve(rootAbs, key);
  const root = path.resolve(rootAbs);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/** Absolute path for a key relative to `productsDir`, or null if it escapes. */
export function resolveUnderProducts(key: string): string | null {
  return resolveUnder(productsDir, key);
}

// ── Firmware tree ──────────────────────────────────────────────────────────
//
// Firmware lives inside the owning sub-product's folder, beside its documents:
//
//   uploads/products/{product}/sub-products/{sub}/documents/firmware/
//     {firmwareId}-{Version}/
//       firmware.hex
//
// That puts it under `uploads/products/`, which IS statically served — and
// firmware accepts EVERY file extension (see routes/firmwares.ts), so an
// uploaded .html or .svg would be stored XSS on this origin. server.ts
// therefore 404s any `/uploads/**` path containing a `firmware` SEGMENT,
// ahead of the static mount; the authenticated download route is the only way
// to read one back. Moving this folder means moving that guard with it.

/** The `firmware/` folder inside an entity's documents folder, relative to
 *  `productsDir`. */
export function firmwareDirFor(entityDir: string): string {
  return `${documentsDirFor(entityDir)}/firmware`;
}

/** Staging area for firmware uploads. A `firmware` segment, so the same guard
 *  that hides the stored files hides half-written ones too — `_tmp` itself is
 *  served, and an unfiltered upload must not sit in it unprotected. */
export const firmwareTmpDir = path.join(tmpDir, 'firmware');

/** `firmwareTmpDir`, created on demand. Multer needs it to already exist. */
export function ensureFirmwareTmpDir(): string {
  fs.mkdirSync(firmwareTmpDir, { recursive: true });
  return firmwareTmpDir;
}

/**
 * A firmware's own folder, relative to `productsDir`, as
 * `{product}/sub-products/{sub}/documents/firmware/{id}-{Version}` — created if
 * missing, parents included.
 */
export function ensureFirmwareDir(
  product: FolderEntity,
  subProduct: FolderEntity,
  firmware: { id: number; name: string },
): string {
  const base = firmwareDirFor(ensureSubProductDir(product, subProduct));
  const baseAbs = path.join(productsDir, base);
  fs.mkdirSync(baseAbs, { recursive: true });
  return `${base}/${ensureEntityFolder(baseAbs, firmware.id, firmware.name, null)}`;
}

/**
 * Remove one firmware's folder. Call only AFTER the deleting transaction has
 * committed — an `rm` cannot be rolled back. Deleting a whole sub-product needs
 * no counterpart: `removeEntityFolder` takes the documents folder, and the
 * firmware tree inside it, with everything else.
 */
export function removeFirmwareDir(
  product: FolderEntity,
  subProduct: FolderEntity,
  firmwareId: number,
): void {
  const entityDir = findEntityDir(product, subProduct);
  if (!entityDir) return;
  const baseAbs = path.join(productsDir, firmwareDirFor(entityDir));
  const folder = findEntityFolder(baseAbs, firmwareId);
  if (!folder) return;
  fs.rmSync(path.join(baseAbs, folder), { recursive: true, force: true });
}
