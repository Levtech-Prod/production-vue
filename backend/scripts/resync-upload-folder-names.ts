// ===========================================================================
// Rename upload folders whose name has drifted from the entity's current
// name / SKU, and rewrite the stored paths that point into them.
//
// Folder names are frozen at creation on purpose (uploads-restructure-plan.md
// §3): folders are located by their immutable `{id}-` prefix, so renaming a
// product never breaks a link and `storage_key` never has to be rewritten. The
// cost is cosmetic — the folder keeps the old name. This script pays that cost
// off in one deliberate batch.
//
// It is NOT wired into any request path, and that is the point: the same work
// on a PATCH handler would mean a partial failure breaking links for a user
// mid-session. Here it is run by hand, after a backup, with a confirmation
// prompt and a full rollback.
//
//   npm run uploads:resync-names            # report, then ask
//   npm run uploads:resync-names -- --yes   # skip the prompt (CI / scripted)
//   npm run uploads:resync-names -- --dry-run
// ===========================================================================
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { pool } from '../src/db.js';
import {
  canonicalFolderName,
  directoriesIn,
  findEntityFolder,
  productsDir,
} from '../src/services/uploadPaths.js';

interface Entity {
  id: number;
  name: string;
  sku: string | null;
}

/** One folder that should be renamed. */
interface Rename {
  scope: 'product' | 'sub-product';
  entityId: number;
  entityName: string;
  /** Folder path relative to `productsDir`, before and after. */
  fromKey: string;
  toKey: string;
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ASSUME_YES = args.has('--yes') || args.has('-y');

// ── Discovery ──────────────────────────────────────────────────────────────

async function collectRenames(): Promise<Rename[]> {
  const products = await pool.query<Entity>(
    `SELECT id, name, sku FROM products ORDER BY id`,
  );

  const renames: Rename[] = [];

  for (const product of products.rows) {
    const currentFolder = findEntityFolder(productsDir, product.id);
    if (!currentFolder) continue;

    const canonical = canonicalFolderName(product.id, product.name, product.sku);
    const productKey = currentFolder;

    if (currentFolder !== canonical) {
      renames.push({
        scope: 'product',
        entityId: product.id,
        entityName: product.name,
        fromKey: productKey,
        toKey: canonical,
      });
    }

    // Sub-product folders are resolved under the product's CURRENT folder name.
    // Their `toKey` is built on the product's canonical name, so when both drift
    // the sub-product rename is expressed against the already-renamed parent —
    // which is why products are applied first (see `apply`).
    const subProducts = await pool.query<Entity>(
      `SELECT id, name, sku FROM sub_products WHERE product_id = $1 ORDER BY id`,
      [product.id],
    );

    const subParentAbs = path.join(productsDir, currentFolder, 'sub-products');
    for (const sub of subProducts.rows) {
      const subFolder = findEntityFolder(subParentAbs, sub.id);
      if (!subFolder) continue;

      const subCanonical = canonicalFolderName(sub.id, sub.name, sub.sku);
      if (subFolder === subCanonical) continue;

      renames.push({
        scope: 'sub-product',
        entityId: sub.id,
        entityName: sub.name,
        fromKey: `${canonical}/sub-products/${subFolder}`,
        toKey: `${canonical}/sub-products/${subCanonical}`,
      });
    }
  }

  return renames;
}

// ── Reporting ──────────────────────────────────────────────────────────────

async function countFolders(): Promise<number> {
  return directoriesIn(productsDir).length;
}

function report(renames: Rename[], productCount: number, folderCount: number): void {
  console.log('');
  console.log(`  Products in database : ${productCount}`);
  console.log(`  Folders on disk      : ${folderCount}`);
  console.log(`  Names out of sync    : ${renames.length}`);
  console.log('');

  if (renames.length === 0) return;

  const width = Math.max(...renames.map((r) => r.fromKey.length));
  for (const rename of renames) {
    const tag = rename.scope === 'product' ? 'product   ' : 'sub-product';
    console.log(`  ${tag}  ${rename.fromKey.padEnd(width)}  ->  ${rename.toKey}`);
  }
  console.log('');
}

async function confirm(count: number): Promise<boolean> {
  if (ASSUME_YES) return true;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`  Rename ${count} folder(s)? [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

// ── Applying ───────────────────────────────────────────────────────────────

/**
 * Rewrite every stored path that points into `fromKey` so it points into
 * `toKey`. Prefix-matched, so renaming a product folder also fixes the keys of
 * every sub-product file beneath it in the same statement.
 *
 * `image` columns hold a public path (`/uploads/products/...`) while
 * `storage_key` is relative to `productsDir`, hence the two different prefixes.
 */
async function rewritePaths(
  client: { query: (text: string, params: unknown[]) => Promise<unknown> },
  fromKey: string,
  toKey: string,
): Promise<void> {
  const publicFrom = `/uploads/products/${fromKey}/`;
  const publicTo = `/uploads/products/${toKey}/`;

  await client.query(
    `UPDATE stored_files
     SET storage_key = $2 || substring(storage_key from length($1) + 1)
     WHERE storage_key LIKE $1 || '%'`,
    [`${fromKey}/`, `${toKey}/`],
  );

  for (const table of ['products', 'sub_products']) {
    await client.query(
      `UPDATE ${table}
       SET image = $2 || substring(image from length($1) + 1)
       WHERE image LIKE $1 || '%'`,
      [publicFrom, publicTo],
    );
  }
}

/**
 * Renames on disk cannot be rolled back by the database, so they are undone by
 * hand if the transaction fails. Products are applied before sub-products: a
 * product rename moves its children with it, and every sub-product `fromKey`
 * was already expressed against the product's canonical name.
 */
async function apply(renames: Rename[]): Promise<void> {
  const ordered = [
    ...renames.filter((r) => r.scope === 'product'),
    ...renames.filter((r) => r.scope === 'sub-product'),
  ];

  const client = await pool.connect();
  const done: Rename[] = [];

  try {
    await client.query('BEGIN');

    for (const rename of ordered) {
      const fromAbs = path.join(productsDir, rename.fromKey);
      const toAbs = path.join(productsDir, rename.toKey);

      if (fs.existsSync(toAbs)) {
        throw new Error(
          `Target folder already exists, refusing to merge: ${rename.toKey}`,
        );
      }

      fs.renameSync(fromAbs, toAbs);
      done.push(rename);
      await rewritePaths(client, rename.fromKey, rename.toKey);
    }

    await client.query('COMMIT');
    console.log(`  Renamed ${done.length} folder(s).`);
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    for (const rename of done.reverse()) {
      fs.renameSync(
        path.join(productsDir, rename.toKey),
        path.join(productsDir, rename.fromKey),
      );
    }
    console.error('  Failed — rolled back, no changes made.');
    throw err;
  } finally {
    client.release();
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Not `existsSync(productsDir)`: that directory also exists in the old flat
  // layout, where it holds loose image files and no per-product folders.
  const folders = directoriesIn(productsDir);
  if (folders.length === 0) {
    console.log('');
    console.log(`  No product folders under ${productsDir} — nothing to do.`);
    console.log('  (If you expected some, the uploads migration has not run yet.)');
    console.log('');
    return;
  }

  const [renames, productCount, folderCount] = await Promise.all([
    collectRenames(),
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM products`)
      .then((r) => Number(r.rows[0].count)),
    countFolders(),
  ]);

  report(renames, productCount, folderCount);

  if (renames.length === 0) {
    console.log('  Everything is in sync.');
    console.log('');
    return;
  }

  if (DRY_RUN) {
    console.log('  --dry-run: nothing changed.');
    console.log('');
    return;
  }

  if (!(await confirm(renames.length))) {
    console.log('  Cancelled, nothing changed.');
    console.log('');
    return;
  }

  await apply(renames);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
