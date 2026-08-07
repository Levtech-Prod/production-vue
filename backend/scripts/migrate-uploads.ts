// ===========================================================================
// One-shot migration of `backend/uploads/` to the product-owned tree
// (uploads-restructure-plan.md §4.4).
//
//   before                            after
//   uploads/products/{ts}.png         uploads/products/{id}-{Name}-{SKU}/image-{ts}.png
//   uploads/sub-products/{ts}.png       …/sub-products/{id}-{Name}-{SKU}/image-{ts}.png
//   uploads/documents/{id}-…/f.pdf      …/{id}-{Name}-{SKU}/documents/f.pdf
//   uploads/documents/sub-{id}-…/f      …/sub-products/{id}-…/documents/f.pdf
//
// Runs against dev and production, so it assumes nothing about the data:
//
//   * Idempotent — anything already in the new shape is skipped, so a re-run
//     after a partial failure resumes rather than double-moving.
//   * Aborts on anything it cannot map (a folder whose name carries no id)
//     rather than guessing. `--skip-unmappable` leaves those in place instead.
//   * Tolerates production drift: a `stored_files` row whose file is missing,
//     or a file on disk with no row, is reported and does not stop the run.
//   * Filename collisions when two old folders merge into one are resolved
//     with a " (n)" suffix, never by overwriting.
//   * Every filesystem move is undone if the transaction fails.
//
//   npm run uploads:migrate -- --dry-run    # plan only, change nothing
//   npm run uploads:migrate                 # plan, then ask
//   npm run uploads:migrate -- --yes
//
// TAKE A DATABASE DUMP AND A COPY OF uploads/ FIRST.
// ===========================================================================
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import type { PoolClient } from 'pg';
import { pool } from '../src/db.js';
import { productsDir, PUBLIC_PREFIX } from '../src/services/uploadPaths.js';
import {
  buildPlan,
  oldDocumentsDir,
  uploadsRoot,
  type Move,
  type Plan,
} from '../src/services/uploadMigration.js';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ASSUME_YES = args.has('--yes') || args.has('-y');
const SKIP_UNMAPPABLE = args.has('--skip-unmappable');

// ── Reporting ──────────────────────────────────────────────────────────────

function report(plan: Plan): void {
  const byKind = (kind: Move['kind']) => plan.moves.filter((m) => m.kind === kind).length;
  const missing = plan.moves.filter((m) => m.missing);

  console.log('');
  console.log(`  Product images      : ${byKind('product image')}`);
  console.log(`  Sub-product images  : ${byKind('sub-product image')}`);
  console.log(`  Documents           : ${byKind('document')}`);
  console.log(`  Already migrated    : ${plan.alreadyDone}`);
  console.log(`  Source file missing : ${missing.length}`);
  console.log(`  Unmappable          : ${plan.unmappable.length}`);
  console.log(`  Orphan files        : ${plan.orphanFiles.length}`);
  console.log('');

  for (const move of plan.moves) {
    const flag = move.missing ? '   [db only, file missing]' : '';
    console.log(`  ${move.kind.padEnd(18)} ${path.relative(uploadsRoot, move.fromAbs)}`);
    console.log(`  ${''.padEnd(18)}   -> products/${move.toKey}${flag}`);
  }

  if (plan.orphanFiles.length > 0) {
    console.log('');
    console.log('  Orphans (no stored_files row) — left in place:');
    for (const file of plan.orphanFiles) console.log(`    uploads/documents/${file}`);
  }

  if (plan.unmappable.length > 0) {
    console.log('');
    console.log('  UNMAPPABLE — cannot derive an owner:');
    for (const item of plan.unmappable) console.log(`    ${item}`);
  }
  console.log('');
}

async function confirm(count: number): Promise<boolean> {
  if (ASSUME_YES) return true;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`  Apply ${count} move(s)? [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

// ── Applying ───────────────────────────────────────────────────────────────

async function recordMove(client: PoolClient, move: Move): Promise<void> {
  if (move.storedFileId !== undefined) {
    await client.query(`UPDATE stored_files SET storage_key = $1 WHERE id = $2`, [
      move.toKey,
      move.storedFileId,
    ]);
    return;
  }

  await client.query(`UPDATE ${move.imageTable} SET image = $1 WHERE id = $2`, [
    `${PUBLIC_PREFIX}/${move.toKey}`,
    move.imageId,
  ]);
}

/**
 * Filesystem moves cannot be rolled back by the database, so they are undone by
 * hand if the transaction fails. A move whose source is already gone updates
 * the row only — the path is corrected even though the bytes are lost, so the
 * database stays internally consistent.
 */
async function apply(plan: Plan): Promise<void> {
  const client = await pool.connect();
  const moved: Move[] = [];

  try {
    await client.query('BEGIN');

    for (const move of plan.moves) {
      if (!move.missing) {
        const toAbs = path.join(productsDir, move.toKey);
        fs.mkdirSync(path.dirname(toAbs), { recursive: true });
        fs.renameSync(move.fromAbs, toAbs);
        moved.push(move);
      }
      await recordMove(client, move);
    }

    await client.query('COMMIT');
    console.log(`  Applied ${plan.moves.length} move(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    for (const move of moved.reverse()) {
      fs.renameSync(path.join(productsDir, move.toKey), move.fromAbs);
    }
    console.error('  Failed — rolled back, nothing changed.');
    throw err;
  } finally {
    client.release();
  }

  pruneEmptyOldFolders();
  console.log('');
}

/** Remove the emptied old folders, leaving anything still holding a file. */
function pruneEmptyOldFolders(): void {
  const prune = (absDir: string): void => {
    if (!fs.existsSync(absDir)) return;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) prune(path.join(absDir, entry.name));
    }
    const left = fs.readdirSync(absDir).filter((name) => name !== '.DS_Store');
    if (left.length === 0) fs.rmSync(absDir, { recursive: true, force: true });
  };

  prune(oldDocumentsDir);
  prune(path.join(uploadsRoot, 'sub-products'));
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const plan = await buildPlan(pool);
  report(plan);

  if (plan.unmappable.length > 0 && !SKIP_UNMAPPABLE) {
    console.error('  Aborting: resolve the unmappable entries above, or re-run');
    console.error('  with --skip-unmappable to leave them where they are.');
    process.exitCode = 1;
    return;
  }

  if (plan.moves.length === 0) {
    console.log('  Nothing to move.');
    console.log('');
    return;
  }

  if (DRY_RUN) {
    console.log('  --dry-run: nothing changed.');
    console.log('');
    return;
  }

  if (!(await confirm(plan.moves.length))) {
    console.log('  Cancelled, nothing changed.');
    console.log('');
    return;
  }

  await apply(plan);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
