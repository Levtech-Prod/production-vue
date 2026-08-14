// Firmware versions, per sub-product revision (migration 019).
//
// A revision carries several firmwares; a firmware belongs to exactly one
// revision. At most one of a revision's firmwares may be `production`, which
// `ux_firmwares_one_production` enforces — promoting a new one demotes the
// current one to `deprecated` in the same transaction, so the index only ever
// fires on a genuine race.
//
// Unlike documents, uploads here are NOT extension-filtered: firmware toolchains
// emit whatever they emit (.uf2, .dfu, vendor programmers). That is only safe
// because these files are never statically served — they sit under
// `.../documents/firmware/`, and server.ts 404s any `/uploads/**` path with a
// `firmware` segment ahead of the static mount, leaving the download route
// below as the sole way to read one back.
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import type { PoolClient } from 'pg';
import { pool, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  firmwareFileUploadSchema,
  firmwarePayloadSchema,
  type FirmwarePayload,
} from '../schemas/firmwares.schema.js';
import {
  findFirmwareContext,
  findRevisionContext,
  placeFirmwareFile,
  resolveFirmwareFilePath,
  unlinkFirmwareFile,
  type FirmwareContext,
} from '../services/firmwareFiles.js';
import {
  ensureFirmwareDir,
  ensureFirmwareTmpDir,
  removeFirmwareDirs,
  safeUnlink,
} from '../services/uploadPaths.js';
import { logAudit, resolveActor, type AuditEvent } from '../services/audit.js';
import { requireId } from './routeParams.js';

const router = Router();

// ── Upload handling ────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES =
  Number(process.env.FIRMWARE_MAX_UPLOAD_MB || 100) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureFirmwareTmpDir()),
  filename: (_req, _file, cb) =>
    cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
});

// No `fileFilter`: every extension is allowed here by design (see the header).
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

/** `upload.array` with the size limit translated into an API error code. */
function uploadFiles(req: Request, res: Response, next: NextFunction) {
  upload.array('files', 20)(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ code: ErrorCodes.FIRMWARE_TOO_LARGE });
    }
    return next(err);
  });
}

/** Files multer wrote for this request, whatever the outcome. */
function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

function discardUploads(req: Request): void {
  for (const file of uploadedFiles(req)) safeUnlink(file.path);
}

/**
 * Validate the multipart text fields. Multer has already written the files to
 * disk by this point, so a rejected body takes them with it rather than
 * leaving them behind.
 */
function parseUploadBody(req: Request) {
  try {
    return firmwareFileUploadSchema.parse(req.body ?? {});
  } catch (err) {
    discardUploads(req);
    throw err;
  }
}

// ── Response shape ─────────────────────────────────────────────────────────

interface FirmwareFileRow {
  id: number;
  firmware_id: number;
  original_name: string;
  size_bytes: string | number;
  mime_type: string | null;
  created_at: string;
}

interface FirmwareRow {
  id: number;
  sub_product_revision_id: number;
  name: string;
  status: string;
  release_notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
}

function fileResponse(row: FirmwareFileRow) {
  return {
    id: row.id,
    originalName: row.original_name,
    sizeBytes: Number(row.size_bytes),
    mimeType: row.mime_type,
    // No static `path` counterpart, unlike documents: firmware files are not
    // served, so this endpoint is the only way to reach one.
    downloadUrl: `/api/firmware-files/${row.id}/download`,
    createdAt: row.created_at,
  };
}

function firmwareResponse(row: FirmwareRow, files: FirmwareFileRow[]) {
  return {
    id: row.id,
    subProductRevisionId: row.sub_product_revision_id,
    name: row.name,
    status: row.status,
    releaseNotes: row.release_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: row.created_by_name,
    files: files.map(fileResponse),
  };
}

const FIRMWARE_COLUMNS = `
  f.id, f.sub_product_revision_id, f.name, f.status, f.release_notes,
  f.created_at, f.updated_at, u.username AS created_by_name`;

/** One revision's firmwares, newest first, each with its files. */
async function listFirmwares(revisionId: number) {
  const [firmwares, files] = await Promise.all([
    query<FirmwareRow>(
      `SELECT ${FIRMWARE_COLUMNS}
         FROM firmwares f
         LEFT JOIN users u ON u.id = f.created_by
        WHERE f.sub_product_revision_id = $1
        ORDER BY f.created_at DESC, f.id DESC`,
      [revisionId],
    ),
    query<FirmwareFileRow>(
      `SELECT ff.id, ff.firmware_id, ff.original_name, ff.size_bytes,
              ff.mime_type, ff.created_at
         FROM firmware_files ff
         JOIN firmwares f ON f.id = ff.firmware_id
        WHERE f.sub_product_revision_id = $1
        ORDER BY ff.original_name`,
      [revisionId],
    ),
  ]);

  const byFirmware = new Map<number, FirmwareFileRow[]>();
  for (const file of files.rows) {
    const list = byFirmware.get(file.firmware_id) ?? [];
    list.push(file);
    byFirmware.set(file.firmware_id, list);
  }

  return firmwares.rows.map((row) => firmwareResponse(row, byFirmware.get(row.id) ?? []));
}

/** One firmware with its files, or null. */
async function loadFirmware(firmwareId: number) {
  const [firmware, files] = await Promise.all([
    query<FirmwareRow>(
      `SELECT ${FIRMWARE_COLUMNS}
         FROM firmwares f
         LEFT JOIN users u ON u.id = f.created_by
        WHERE f.id = $1`,
      [firmwareId],
    ),
    query<FirmwareFileRow>(
      `SELECT id, firmware_id, original_name, size_bytes, mime_type, created_at
         FROM firmware_files WHERE firmware_id = $1 ORDER BY original_name`,
      [firmwareId],
    ),
  ]);
  const row = firmware.rows[0];
  return row ? firmwareResponse(row, files.rows) : null;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Did this error come from the given unique index? */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e?.constraint === constraint;
}

/**
 * Clear the way for a `production` firmware on this revision by deprecating
 * whichever one currently holds the slot. Must run before the insert/update
 * that claims it, or `ux_firmwares_one_production` rejects the statement.
 *
 * Returns the change-log entries for the demotion — empty when the slot was
 * free. Building them here rather than at the two call sites keeps the
 * demotion and its audit trail from drifting apart.
 */
async function demoteCurrentProduction(
  client: PoolClient,
  context: FirmwareContext,
  exceptId: number | null,
): Promise<AuditEvent[]> {
  const result = await client.query<{ name: string }>(
    `UPDATE firmwares
        SET status = 'deprecated', updated_at = NOW()
      WHERE sub_product_revision_id = $1
        AND status = 'production'
        AND ($2::int IS NULL OR id <> $2)
      RETURNING name`,
    [context.revisionId, exceptId],
  );
  return result.rows.map((row) => ({
    type: 'firmware',
    tag: 'changed',
    label: row.name,
    scope: firmwareScope(context),
    from: 'production',
    to: 'deprecated',
  }));
}

/**
 * Record firmware changes in the owning PRODUCT's change log, so they show up
 * beside every other change to the product rather than in a log of their own.
 * A firmware under a sub-product with no parent product has nowhere to go and
 * is skipped.
 */
async function logFirmwareEvents(
  client: PoolClient,
  context: FirmwareContext,
  userId: number | null | undefined,
  events: AuditEvent[],
): Promise<void> {
  if (events.length === 0 || context.product === null) return;
  const actor = await resolveActor(client, userId);
  await logAudit(client, 'product', context.product.id, 'updated', { events }, actor);
}

/** Where a firmware event happened, as a change-log breadcrumb. */
function firmwareScope(context: FirmwareContext) {
  return [
    { type: 'sub_product', label: context.subProduct.name },
    { type: 'sub_product_revision', label: context.revisionLabel },
  ];
}

/** The human-readable summary of a firmware, for change-log from/to cells. */
function firmwareDetails(status: string, releaseNotes: string | null): string {
  return releaseNotes ? `${status} — ${releaseNotes}` : status;
}

// ── Firmware CRUD ──────────────────────────────────────────────────────────

// GET /api/sub-products/:spId/revisions/:revId/firmwares
router.get('/sub-products/:spId/revisions/:revId/firmwares', requireAuth, async (req, res) => {
  const spId = requireId(res, req.params.spId, ErrorCodes.INVALID_SUB_PRODUCT_ID);
  if (spId === null) return;
  const revId = requireId(res, req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  if (revId === null) return;

  // Independent: the context is only a 404 check, so it need not gate the
  // list. One round-trip instead of two on the common path; the wasted list
  // query on a 404 is far cheaper than the extra latency on every hit.
  const [context, firmwares] = await Promise.all([
    findRevisionContext(pool, spId, revId),
    listFirmwares(revId),
  ]);
  if (!context) return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });

  res.json({ firmwares });
});

// POST /api/sub-products/:spId/revisions/:revId/firmwares
router.post('/sub-products/:spId/revisions/:revId/firmwares', requireAuth, async (req, res) => {
  const spId = requireId(res, req.params.spId, ErrorCodes.INVALID_SUB_PRODUCT_ID);
  if (spId === null) return;
  const revId = requireId(res, req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  if (revId === null) return;

  const data: FirmwarePayload = firmwarePayloadSchema.parse(req.body ?? {});
  const context = await findRevisionContext(pool, spId, revId);
  if (!context) return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });

  let newFirmwareId: number;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const events: AuditEvent[] = [];
    if (data.status === 'production') {
      events.push(...(await demoteCurrentProduction(client, context, null)));
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO firmwares
         (sub_product_revision_id, name, status, release_notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [revId, data.name, data.status, data.releaseNotes, req.user?.id ?? null],
    );
    newFirmwareId = inserted.rows[0].id;

    events.push({
      type: 'firmware',
      tag: 'added',
      label: data.name,
      scope: firmwareScope(context),
      to: firmwareDetails(data.status, data.releaseNotes),
    });
    await logFirmwareEvents(client, context, req.user?.id, events);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err, 'ux_firmwares_revision_name')) {
      return res.status(409).json({ code: ErrorCodes.FIRMWARE_NAME_ALREADY_EXISTS });
    }
    throw err;
  } finally {
    client.release();
  }

  // Reloaded only after the client is back in the pool: `loadFirmware` checks
  // one out itself, and holding two per request deadlocks the pool under
  // concurrency. Outside the `catch` for a second reason — a read failing here
  // must not issue a ROLLBACK against an already-committed transaction.
  res.status(201).json(await loadFirmware(newFirmwareId));
});

// PUT /api/firmwares/:id
router.put('/firmwares/:id', requireAuth, async (req, res) => {
  const firmwareId = requireId(res, req.params.id, ErrorCodes.INVALID_FIRMWARE_ID);
  if (firmwareId === null) return;

  const data: FirmwarePayload = firmwarePayloadSchema.parse(req.body ?? {});
  const context = await findFirmwareContext(pool, firmwareId);
  if (!context) return res.status(404).json({ code: ErrorCodes.FIRMWARE_NOT_FOUND });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query<{ status: string; release_notes: string | null; name: string }>(
      `SELECT name, status, release_notes FROM firmwares WHERE id = $1 FOR UPDATE`,
      [firmwareId],
    );
    const previous = before.rows[0];
    if (!previous) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.FIRMWARE_NOT_FOUND });
    }

    const events: AuditEvent[] = [];
    if (data.status === 'production' && previous.status !== 'production') {
      events.push(...(await demoteCurrentProduction(client, context, firmwareId)));
    }

    await client.query(
      `UPDATE firmwares
          SET name = $2, status = $3, release_notes = $4, updated_at = NOW()
        WHERE id = $1`,
      [firmwareId, data.name, data.status, data.releaseNotes],
    );

    const changed =
      previous.name !== data.name ||
      previous.status !== data.status ||
      (previous.release_notes ?? null) !== data.releaseNotes;
    if (changed) {
      events.push({
        type: 'firmware',
        tag: 'changed',
        label: data.name,
        scope: firmwareScope(context),
        from: firmwareDetails(previous.status, previous.release_notes),
        to: firmwareDetails(data.status, data.releaseNotes),
      });
    }
    await logFirmwareEvents(client, context, req.user?.id, events);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err, 'ux_firmwares_revision_name')) {
      return res.status(409).json({ code: ErrorCodes.FIRMWARE_NAME_ALREADY_EXISTS });
    }
    throw err;
  } finally {
    client.release();
  }

  // After `client.release()` — see the create handler above.
  res.json(await loadFirmware(firmwareId));
});

// DELETE /api/firmwares/:id
router.delete('/firmwares/:id', requireAuth, async (req, res) => {
  const firmwareId = requireId(res, req.params.id, ErrorCodes.INVALID_FIRMWARE_ID);
  if (firmwareId === null) return;

  const context = await findFirmwareContext(pool, firmwareId);
  if (!context) return res.status(404).json({ code: ErrorCodes.FIRMWARE_NOT_FOUND });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query<{ id: number }>(
      `DELETE FROM firmwares WHERE id = $1 RETURNING id`,
      [firmwareId],
    );
    if (deleted.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.FIRMWARE_NOT_FOUND });
    }

    await logFirmwareEvents(client, context, req.user?.id, [
      {
        type: 'firmware',
        tag: 'removed',
        label: context.firmwareName,
        scope: firmwareScope(context),
      },
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Post-commit: `firmware_files` cascaded, so the whole folder goes.
  if (context.product) removeFirmwareDirs(context.product, context.subProduct, [firmwareId]);
  res.json({ id: firmwareId, deleted: true });
});

// ── Firmware files ─────────────────────────────────────────────────────────

// POST /api/firmwares/:id/files — multipart, several files at a time
router.post('/firmwares/:id/files', requireAuth, uploadFiles, async (req, res) => {
  const firmwareId = requireId(res, req.params.id, ErrorCodes.INVALID_FIRMWARE_ID);
  if (firmwareId === null) {
    discardUploads(req);
    return;
  }

  const files = uploadedFiles(req);
  if (files.length === 0) return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });

  const { names } = parseUploadBody(req);

  // Both depend only on `firmwareId`, so they go together. Which storage keys
  // already exist decides two things below: whether the
  // change log calls an upload an addition or a replacement, and — more
  // importantly — which files may be unlinked if the transaction fails. An
  // upload that overwrote an existing file has already destroyed the old
  // bytes, so unlinking it on rollback would leave a surviving row pointing
  // at nothing; only genuinely new files can be taken back.
  const [context, existing] = await Promise.all([
    findFirmwareContext(pool, firmwareId),
    query<{ storage_key: string }>(
      `SELECT storage_key FROM firmware_files WHERE firmware_id = $1`,
      [firmwareId],
    ),
  ]);
  if (!context) {
    discardUploads(req);
    return res.status(404).json({ code: ErrorCodes.FIRMWARE_NOT_FOUND });
  }
  const existingKeys = new Set(existing.rows.map((row) => row.storage_key));

  // The firmware folder lives inside the main product's tree, so a parentless
  // sub-product has nowhere to put the file. Only possible on data predating
  // migration 014, which made the parent required.
  const product = context.product;
  if (!product) {
    discardUploads(req);
    return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
  }

  // Resolved once, not per file: it walks and creates three directory levels.
  const folder = ensureFirmwareDir(product, context.subProduct, {
    id: firmwareId,
    name: context.firmwareName,
  });
  const placed = files.map((file, index) => ({
    file,
    ...placeFirmwareFile(file, folder, names[index]),
  }));

  // `pool.connect()` is inside the try so that a failure to get a client is
  // covered by the same cleanup as a failed transaction — by this point the
  // bytes have already left `_tmp`, so nothing else would ever reclaim them.
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const events: AuditEvent[] = [];

    for (const item of placed) {
      // Re-uploading a file of the same name overwrites it, so the row is
      // updated in place rather than duplicated (see `placeFirmwareFile`).
      await client.query(
        `INSERT INTO firmware_files
           (firmware_id, storage_key, original_name, size_bytes, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (storage_key) DO UPDATE
           SET size_bytes  = EXCLUDED.size_bytes,
               mime_type   = EXCLUDED.mime_type,
               uploaded_by = EXCLUDED.uploaded_by,
               created_at  = NOW()`,
        [
          firmwareId,
          item.storageKey,
          item.originalName,
          item.file.size,
          item.file.mimetype,
          req.user?.id ?? null,
        ],
      );
      events.push({
        type: 'firmware_file',
        tag: existingKeys.has(item.storageKey) ? 'changed' : 'added',
        label: item.originalName,
        scope: [...firmwareScope(context), { type: 'firmware', label: context.firmwareName }],
        to: context.firmwareName,
      });
    }

    await logFirmwareEvents(client, context, req.user?.id, events);
    await client.query('COMMIT');
  } catch (err) {
    await client?.query('ROLLBACK');
    for (const item of placed) {
      if (!existingKeys.has(item.storageKey)) unlinkFirmwareFile(item.storageKey);
    }
    throw err;
  } finally {
    client?.release();
  }

  res.status(201).json(await loadFirmware(firmwareId));
});

// DELETE /api/firmware-files/:fileId
router.delete('/firmware-files/:fileId', requireAuth, async (req, res) => {
  const fileId = requireId(res, req.params.fileId, ErrorCodes.INVALID_FIRMWARE_FILE_ID);
  if (fileId === null) return;

  let storageKey: string;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query<{
      storage_key: string;
      firmware_id: number;
      original_name: string;
    }>(
      `DELETE FROM firmware_files WHERE id = $1
       RETURNING storage_key, firmware_id, original_name`,
      [fileId],
    );
    const row = deleted.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.FIRMWARE_FILE_NOT_FOUND });
    }
    storageKey = row.storage_key;

    // Without this the change log shows firmware files appearing and never
    // disappearing, which misrepresents the current state rather than merely
    // omitting it.
    const context = await findFirmwareContext(client, row.firmware_id);
    if (context) {
      await logFirmwareEvents(client, context, req.user?.id, [
        {
          type: 'firmware_file',
          tag: 'removed',
          label: row.original_name,
          scope: [...firmwareScope(context), { type: 'firmware', label: context.firmwareName }],
          from: context.firmwareName,
        },
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  unlinkFirmwareFile(storageKey);
  res.json({ id: fileId, deleted: true });
});

// GET /api/firmware-files/:fileId/download — the ONLY way to read a firmware
// file: server.ts refuses to serve any path with a `firmware` segment.
router.get('/firmware-files/:fileId/download', requireAuth, async (req, res) => {
  const fileId = requireId(res, req.params.fileId, ErrorCodes.INVALID_FIRMWARE_FILE_ID);
  if (fileId === null) return;

  const result = await query<{ storage_key: string; original_name: string; mime_type: string | null }>(
    `SELECT storage_key, original_name, mime_type FROM firmware_files WHERE id = $1`,
    [fileId],
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ code: ErrorCodes.FIRMWARE_FILE_NOT_FOUND });

  const absolute = resolveFirmwareFilePath(row.storage_key);
  if (!absolute || !fs.existsSync(absolute)) {
    return res.status(404).json({ code: ErrorCodes.FIRMWARE_FILE_MISSING });
  }
  if (row.mime_type) res.type(row.mime_type);
  return res.download(absolute, row.original_name);
});

export default router;
