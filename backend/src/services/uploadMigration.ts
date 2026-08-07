// ===========================================================================
// Planning half of the one-shot uploads migration (see
// scripts/migrate-uploads.ts for the CLI, and uploads-restructure-plan.md §4.4).
//
// Kept out of the script and free of any connection of its own so the mapping
// rules — which run once, against production data, and cannot be eyeballed
// beforehand — are testable.
// ===========================================================================
import fs from 'fs';
import path from 'path';
import { canonicalFolderName, productsDir } from './uploadPaths.js';
import type { Queryable } from './documentFiles.js';

export const uploadsRoot = path.join(process.cwd(), 'uploads');
export const oldDocumentsDir = path.join(uploadsRoot, 'documents');

interface ProductRow {
  id: number;
  name: string;
  sku: string | null;
  image: string | null;
}

interface SubProductRow extends ProductRow {
  product_id: number | null;
}

/** One planned file move plus the database value that must follow it. */
export interface Move {
  kind: 'product image' | 'sub-product image' | 'document';
  fromAbs: string;
  /** Destination relative to `productsDir`. */
  toKey: string;
  /** For documents: the `stored_files` row to repoint. */
  storedFileId?: number;
  /** For images: the table and id whose `image` column to rewrite. */
  imageTable?: 'products' | 'sub_products';
  imageId?: number;
  /** Source file is not on disk — rewrite the path, move nothing. */
  missing: boolean;
}

export interface Plan {
  moves: Move[];
  /** Things whose owner cannot be derived; the run aborts on these. */
  unmappable: string[];
  /** Files under the old tree that no `stored_files` row points at. */
  orphanFiles: string[];
  /** Rows already in the new shape — what makes a re-run safe. */
  alreadyDone: number;
}

// ── Naming ─────────────────────────────────────────────────────────────────

interface Layout {
  productDir: Map<number, string>;
  subProductDir: Map<number, string>;
}

function buildLayout(products: ProductRow[], subProducts: SubProductRow[]): Layout {
  const productDir = new Map<number, string>();
  for (const product of products) {
    productDir.set(product.id, canonicalFolderName(product.id, product.name, product.sku));
  }

  const subProductDir = new Map<number, string>();
  for (const sub of subProducts) {
    if (sub.product_id === null) continue;
    const parent = productDir.get(sub.product_id);
    if (!parent) continue;
    const own = canonicalFolderName(sub.id, sub.name, sub.sku);
    subProductDir.set(sub.id, `${parent}/sub-products/${own}`);
  }

  return { productDir, subProductDir };
}

/**
 * Which entity an OLD documents folder belonged to. The old scheme prefixed
 * sub-products with `sub-` and products with nothing, both followed by the id.
 * A folder named before that convention carries no id and is unmappable — it
 * must be resolved by hand rather than guessed at.
 */
function parseOldDocumentFolder(
  folder: string,
): { scope: 'product' | 'subProduct'; id: number } | null {
  const sub = /^sub-(\d+)-/.exec(folder);
  if (sub) return { scope: 'subProduct', id: Number(sub[1]) };
  const product = /^(\d+)-/.exec(folder);
  if (product) return { scope: 'product', id: Number(product[1]) };
  return null;
}

/**
 * Reserve a destination name, suffixing " (n)" rather than overwriting. Two old
 * folders can map to one new folder (a product that ended up with two), and
 * their files may collide.
 */
function reserveName(taken: Set<string>, dirKey: string, fileName: string): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length) || fileName;

  let candidate = fileName;
  let counter = 1;
  while (
    taken.has(`${dirKey}/${candidate}`) ||
    fs.existsSync(path.join(productsDir, dirKey, candidate))
  ) {
    candidate = `${stem} (${counter})${ext}`;
    counter += 1;
  }
  taken.add(`${dirKey}/${candidate}`);
  return candidate;
}

// ── Images ─────────────────────────────────────────────────────────────────

/**
 * An `image` column value, classified. The old flat form has exactly one
 * segment after the folder; anything deeper is already migrated.
 */
type ClassifiedImage =
  | { state: 'flat'; dir: 'products' | 'sub-products'; file: string }
  | { state: 'done' | 'empty' | 'foreign' };

function classifyImage(image: string | null): ClassifiedImage {
  if (!image) return { state: 'empty' };
  if (!image.startsWith('/uploads/')) return { state: 'foreign' };

  const parts = image.slice('/uploads/'.length).split('/');
  if ((parts[0] === 'products' || parts[0] === 'sub-products') && parts.length === 2) {
    return { state: 'flat', dir: parts[0], file: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'products' && parts.length > 2) return { state: 'done' };
  return { state: 'foreign' };
}

/** `1784538441249-203564886.png` -> `image-1784538441249.png`. Keeping the
 *  upload timestamp is what stops a replaced image being served from cache. */
function imageTargetName(sourceFile: string): string {
  const ext = path.extname(sourceFile).toLowerCase();
  const stem = path.basename(sourceFile, path.extname(sourceFile));
  return `image-${stem.split('-')[0]}${ext}`;
}

function planImages(
  rows: ProductRow[],
  dirFor: Map<number, string>,
  kind: 'product image' | 'sub-product image',
  table: 'products' | 'sub_products',
  taken: Set<string>,
  plan: Plan,
): void {
  for (const row of rows) {
    const classified = classifyImage(row.image);

    // Checked positively so `state` narrows on the 'flat' unit type: the other
    // member's `state` is a union, which stops TS treating it as a discriminant
    // and would leave `dir` / `file` unreachable below.
    if (classified.state !== 'flat') {
      if (classified.state === 'done') plan.alreadyDone += 1;
      // 'foreign' — a path we did not write and cannot place.
      if (classified.state === 'foreign') {
        plan.unmappable.push(`${table} #${row.id} image: ${row.image}`);
      }
      // 'empty' — a legacy row with no image at all (migration 003).
      continue;
    }

    const dirKey = dirFor.get(row.id);
    if (!dirKey) {
      plan.unmappable.push(`${table} #${row.id} has no folder (missing parent product?)`);
      continue;
    }

    const fromAbs = path.join(uploadsRoot, classified.dir, classified.file);
    plan.moves.push({
      kind,
      fromAbs,
      toKey: `${dirKey}/${reserveName(taken, dirKey, imageTargetName(classified.file))}`,
      imageTable: table,
      imageId: row.id,
      missing: !fs.existsSync(fromAbs),
    });
  }
}

// ── Documents ──────────────────────────────────────────────────────────────

async function planDocuments(
  db: Queryable,
  layout: Layout,
  taken: Set<string>,
  plan: Plan,
): Promise<void> {
  const stored = await db.query<{ id: number; storage_key: string }>(
    `SELECT id, storage_key FROM stored_files ORDER BY id`,
  );

  const claimed = new Set<string>();

  for (const row of stored.rows) {
    // Claimed as soon as it is SEEN, not once it is successfully mapped: a file
    // whose row is unmappable still has a row, and reporting it as an orphan as
    // well would send someone chasing the same file twice.
    claimed.add(row.storage_key);

    const segments = row.storage_key.split('/');

    // Already relative to the new tree: `{id}-…/documents/file` or deeper.
    if (segments.includes('documents')) {
      plan.alreadyDone += 1;
      continue;
    }

    if (segments.length !== 2) {
      plan.unmappable.push(`stored_files #${row.id}: ${row.storage_key}`);
      continue;
    }

    const [folder, fileName] = segments;
    const parsed = parseOldDocumentFolder(folder);
    if (!parsed) {
      plan.unmappable.push(`stored_files #${row.id}: ${row.storage_key}`);
      continue;
    }

    const dirKey =
      parsed.scope === 'product'
        ? layout.productDir.get(parsed.id)
        : layout.subProductDir.get(parsed.id);
    if (!dirKey) {
      plan.unmappable.push(
        `stored_files #${row.id}: ${row.storage_key} — no such ${parsed.scope} #${parsed.id}`,
      );
      continue;
    }

    const documentsKey = `${dirKey}/documents`;
    const fromAbs = path.join(oldDocumentsDir, folder, fileName);

    plan.moves.push({
      kind: 'document',
      fromAbs,
      toKey: `${documentsKey}/${reserveName(taken, documentsKey, fileName)}`,
      storedFileId: row.id,
      missing: !fs.existsSync(fromAbs),
    });
  }

  collectOrphans(claimed, plan);
}

function collectOrphans(claimed: Set<string>, plan: Plan): void {
  if (!fs.existsSync(oldDocumentsDir)) return;

  const walk = (absDir: string, relDir: string): void => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(absDir, entry.name), rel);
      } else if (entry.name !== '.DS_Store' && !claimed.has(rel)) {
        plan.orphanFiles.push(rel);
      }
    }
  };

  walk(oldDocumentsDir, '');
}

// ── Entry point ────────────────────────────────────────────────────────────

/** Work out every move without touching disk or database. */
export async function buildPlan(db: Queryable): Promise<Plan> {
  const [products, subProducts] = await Promise.all([
    db.query<ProductRow>(`SELECT id, name, sku, image FROM products ORDER BY id`),
    db.query<SubProductRow>(
      `SELECT id, product_id, name, sku, image FROM sub_products ORDER BY id`,
    ),
  ]);

  const layout = buildLayout(products.rows, subProducts.rows);
  const plan: Plan = { moves: [], unmappable: [], orphanFiles: [], alreadyDone: 0 };
  const taken = new Set<string>();

  planImages(products.rows, layout.productDir, 'product image', 'products', taken, plan);
  planImages(
    subProducts.rows,
    layout.subProductDir,
    'sub-product image',
    'sub_products',
    taken,
    plan,
  );
  await planDocuments(db, layout, taken, plan);

  return plan;
}
