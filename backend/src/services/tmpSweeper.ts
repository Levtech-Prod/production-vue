// ===========================================================================
// Remove abandoned staging files.
//
// An image is uploaded to `_tmp` as soon as the user picks it, but only filed
// into a product folder when the form is submitted. A form that is closed
// instead leaves the file behind, so without this `_tmp` grows forever.
// ===========================================================================
import fs from 'fs';
import path from 'path';
import { pool } from '../db.js';
import { firmwareTmpDir, tmpDir, TMP_PUBLIC_PREFIX } from './uploadPaths.js';

/** How long a staged file may sit unclaimed. Long enough to cover a form left
 *  open over a lunch break, short enough that `_tmp` stays small. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * File names still referenced by an `image` column. A row whose image never got
 * filed (a crash between the insert and the move) would otherwise have its file
 * swept out from under it, turning a real product image into a 404.
 */
async function stagedNamesInUse(): Promise<Set<string>> {
  const result = await pool.query<{ image: string }>(
    `SELECT image FROM products WHERE image LIKE $1 || '%'
     UNION
     SELECT image FROM sub_products WHERE image LIKE $1 || '%'`,
    [`${TMP_PUBLIC_PREFIX}/`],
  );
  return new Set(
    result.rows.map((row) => path.basename(decodeURIComponent(row.image))),
  );
}

/** Delete files older than `MAX_AGE_MS` from one staging dir, skipping any
 *  name in `inUse`. Returns the count removed. */
function sweepDir(dir: string, inUse: Set<string>): number {
  if (!fs.existsSync(dir)) return 0;

  const cutoff = Date.now() - MAX_AGE_MS;
  let removed = 0;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (inUse.has(entry.name)) continue;

    const absolute = path.join(dir, entry.name);
    try {
      if (fs.statSync(absolute).mtimeMs > cutoff) continue;
      fs.unlinkSync(absolute);
      removed += 1;
    } catch (err) {
      console.error(`Failed to sweep ${absolute}`, err);
    }
  }

  return removed;
}

/** Sweep both staging dirs (`sweepDir` skips subdirectories, so the nested
 *  firmware one does not sweep itself). Firmware needs no in-use check: a
 *  firmware upload is filed within the request that staged it, so nothing ever
 *  holds a reference to a file still sitting there. */
async function sweepTmp(): Promise<number> {
  return sweepDir(tmpDir, await stagedNamesInUse()) + sweepDir(firmwareTmpDir, new Set());
}

/** Sweep on boot, then hourly. Failures are logged, never fatal. */
export function startTmpSweeper(): void {
  const run = () => {
    sweepTmp()
      .then((removed) => {
        if (removed > 0) console.log(`Swept ${removed} stale file(s) from _tmp`);
      })
      .catch((err) => console.error('_tmp sweep failed', err));
  };

  run();
  // `unref` so a pending timer cannot hold the process open on shutdown.
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}
