// ===========================================================================
// Product / sub-product images: staging, filing and cleanup.
//
// The form uploads the image before the entity exists, so there is no row
// and no id to file it under yet. The upload lands in `_tmp` and the
// create/update handler calls `fileStagedImage` once the id is known, which
// moves it into the entity's folder and returns the final public path to
// store.
//
// Same two-phase shape `documents.ts` already uses for its `tmp-` files.
// ===========================================================================
import fs from 'fs';
import path from 'path';
import {
  ensureProductDir,
  ensureSubProductDir,
  productsDir,
  PUBLIC_PREFIX,
  resolveUnderProducts,
  tmpDir,
  TMP_PUBLIC_PREFIX,
  type FolderEntity,
} from './uploadPaths.js';

/** Whether a stored `image` value is still sitting in the staging area. */
function isStagedImage(image: string | null | undefined): boolean {
  return typeof image === 'string' && image.startsWith(`${TMP_PUBLIC_PREFIX}/`);
}

/**
 * The image file name inside an entity folder. Keeps the uploaded timestamp so
 * replacing an image always produces a new URL — uploads are served statically
 * and a stable name (`image.png`) would be cached by the browser and keep
 * showing the old picture.
 */
function imageFileName(stagedName: string): string {
  const ext = path.extname(stagedName).toLowerCase();
  return `image-${Date.now()}${ext}`;
}

/**
 * Move a `_tmp` image into the entity's folder and return the public path to
 * store in the `image` column. A value that is not staged is returned
 * unchanged, so calling this on an unmodified entity is a no-op.
 *
 * Returns null when the staged file is gone — an abandoned form swept after
 * 24h, or a double submit. The caller decides whether that is fatal.
 */
export function fileStagedImage(
  image: string,
  entity: FolderEntity,
  parentProduct: FolderEntity | null,
): string | null {
  if (!isStagedImage(image)) return image;

  const stagedName = path.basename(decodeURIComponent(image));
  const stagedAbs = path.join(tmpDir, stagedName);
  // `basename` already strips separators; this rejects the leftovers ('..').
  if (path.dirname(path.resolve(stagedAbs)) !== path.resolve(tmpDir)) return null;
  if (!fs.existsSync(stagedAbs)) return null;

  const entityDir =
    parentProduct === null
      ? ensureProductDir(entity)
      : ensureSubProductDir(parentProduct, entity);

  const fileName = imageFileName(stagedName);
  fs.mkdirSync(path.join(productsDir, entityDir), { recursive: true });
  fs.renameSync(stagedAbs, path.join(productsDir, entityDir, fileName));

  return `${PUBLIC_PREFIX}/${entityDir}/${fileName}`;
}

/**
 * Delete an image file by its public path. Used when an entity's image is
 * replaced; a path that is not ours, or a file already gone, is ignored.
 */
export function removeImageFile(image: string | null | undefined): void {
  if (typeof image !== 'string') return;
  if (!image.startsWith(`${PUBLIC_PREFIX}/`)) return;

  const key = decodeURIComponent(image.slice(PUBLIC_PREFIX.length + 1));
  const absolute = resolveUnderProducts(key);
  if (!absolute || !fs.existsSync(absolute)) return;

  try {
    fs.unlinkSync(absolute);
  } catch (err) {
    console.error(`Failed to unlink image ${absolute}`, err);
  }
}
