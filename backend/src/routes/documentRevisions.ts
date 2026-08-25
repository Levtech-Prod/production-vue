// Versions on a revision-mode document type (migration 022).
//
// A card carries several versions; a version belongs to exactly one card. At
// most one of a card's versions may be `production`, which the partial unique
// indexes enforce — promoting a new one demotes the current one to
// `deprecated` in the same transaction, so the index only ever fires on a
// genuine race.
//
// A card with no `allowedExtensions` accepts EVERY extension: firmware
// toolchains emit whatever they emit (.uf2, .dfu, vendor programmers), and the
// global document allow-list would reject most of it. That is only safe because
// these files are never statically served — they sit under
// `.../documents/revisions/`, and server.ts 404s any `/uploads/**` path with a
// `revisions` segment ahead of the static mount, leaving the download route
// below as the sole way to read one back.
//
// Both template families are structurally identical, so the list/create pair is
// written once against a `DocumentScope` and registered twice.
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import type { PoolClient } from 'pg';
import { pool, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  documentRevisionFileUploadSchema,
  documentRevisionPayloadSchema,
  type DocumentRevisionPayload,
} from '../schemas/documentRevisions.schema.js';
import {
  documentTypeTableFor,
  ensureRevisionDir,
  findRevisionOwner,
  findRevisionOwnerByType,
  listRevisionFileKeys,
  ownerProduct,
  placeRevisionFile,
  removeRevisionFiles,
  resolveRevisionFilePath,
  revisionColumnFor,
  unlinkRevisionFile,
  type RevisionOwner,
} from '../services/documentRevisions.js';
import { fileExtension, type DocumentScope } from '../services/documentFiles.js';
import { ensureDocumentRevisionTmpDir, safeUnlink } from '../services/uploadPaths.js';
import { logAudit, resolveActor, type AuditEvent } from '../services/audit.js';
import { requireId } from './routeParams.js';

const router = Router();

// ── Upload handling ────────────────────────────────────────────────────────

const MAX_UPLOAD_FILES = 20;

// Falls back rather than trusting the parse: multer reads `fileSize: NaN` as
// "no limit", so a typo in the env var would silently remove the cap.
const configuredMb = Number(process.env.DOCUMENT_REVISION_MAX_UPLOAD_MB);
const MAX_UPLOAD_BYTES =
  (Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 100) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureDocumentRevisionTmpDir()),
  filename: (_req, _file, cb) =>
    cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
});

// No `fileFilter`: which extensions are allowed depends on the card, which is
// only known once the request has been routed (see `extensionRejected`).
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

/** `upload.array` with its rejections translated into API error codes. Multer
 *  surfaces all of them as thrown errors, which would otherwise reach the global
 *  handler as a generic 500 and leave the UI with nothing specific to say. */
function uploadFiles(req: Request, res: Response, next: NextFunction) {
  upload.array('files', MAX_UPLOAD_FILES)(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ code: ErrorCodes.DOCUMENT_REVISION_FILE_TOO_LARGE });
      }
      // LIMIT_FILE_COUNT for too many at once, LIMIT_UNEXPECTED_FILE for a part
      // under another field name.
      return res.status(400).json({
        code: ErrorCodes.DOCUMENT_REVISION_TOO_MANY_FILES,
        max: MAX_UPLOAD_FILES,
      });
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
    return documentRevisionFileUploadSchema.parse(req.body ?? {});
  } catch (err) {
    discardUploads(req);
    throw err;
  }
}

/** The first uploaded file the card does not accept, or null. An empty list on
 *  the card means it takes anything. */
function extensionRejected(owner: RevisionOwner, files: Express.Multer.File[]): boolean {
  if (owner.allowedExtensions.length === 0) return false;
  return files.some((file) => !owner.allowedExtensions.includes(fileExtension(file.originalname)));
}

// ── Response shape ─────────────────────────────────────────────────────────

interface RevisionFileRow {
  id: number;
  document_revision_id: number;
  original_name: string;
  size_bytes: string | number;
  mime_type: string | null;
  created_at: string;
}

interface RevisionRow {
  id: number;
  document_type_id: number;
  name: string;
  status: string;
  release_notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
}

function fileResponse(row: RevisionFileRow) {
  return {
    id: row.id,
    originalName: row.original_name,
    sizeBytes: Number(row.size_bytes),
    mimeType: row.mime_type,
    // No static `path` counterpart, unlike documents: version files are not
    // served, so this endpoint is the only way to reach one.
    downloadUrl: `/api/document-revision-files/${row.id}/download`,
    createdAt: row.created_at,
  };
}

function revisionResponse(row: RevisionRow, files: RevisionFileRow[]) {
  return {
    id: row.id,
    documentTypeId: row.document_type_id,
    name: row.name,
    status: row.status,
    releaseNotes: row.release_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: row.created_by_name,
    files: files.map(fileResponse),
  };
}

function revisionColumns(scope: DocumentScope): string {
  return `
    dr.id, dr.${revisionColumnFor(scope)} AS document_type_id, dr.name, dr.status,
    dr.release_notes, dr.created_at, dr.updated_at, u.username AS created_by_name`;
}

/** One card's versions, newest first, each with its files. */
async function listRevisions(scope: DocumentScope, documentTypeId: number) {
  const column = revisionColumnFor(scope);
  const [revisions, files] = await Promise.all([
    query<RevisionRow>(
      `SELECT ${revisionColumns(scope)}
         FROM document_revisions dr
         LEFT JOIN users u ON u.id = dr.created_by
        WHERE dr.${column} = $1
        ORDER BY dr.created_at DESC, dr.id DESC`,
      [documentTypeId],
    ),
    query<RevisionFileRow>(
      `SELECT f.id, f.document_revision_id, f.original_name, f.size_bytes,
              f.mime_type, f.created_at
         FROM document_revision_files f
         JOIN document_revisions dr ON dr.id = f.document_revision_id
        WHERE dr.${column} = $1
        ORDER BY f.original_name`,
      [documentTypeId],
    ),
  ]);

  const byRevision = new Map<number, RevisionFileRow[]>();
  for (const file of files.rows) {
    const list = byRevision.get(file.document_revision_id) ?? [];
    list.push(file);
    byRevision.set(file.document_revision_id, list);
  }

  return revisions.rows.map((row) => revisionResponse(row, byRevision.get(row.id) ?? []));
}

/** One version with its files, or null. */
async function loadRevision(scope: DocumentScope, revisionId: number) {
  const [revision, files] = await Promise.all([
    query<RevisionRow>(
      `SELECT ${revisionColumns(scope)}
         FROM document_revisions dr
         LEFT JOIN users u ON u.id = dr.created_by
        WHERE dr.id = $1`,
      [revisionId],
    ),
    query<RevisionFileRow>(
      `SELECT id, document_revision_id, original_name, size_bytes, mime_type, created_at
         FROM document_revision_files WHERE document_revision_id = $1
        ORDER BY original_name`,
      [revisionId],
    ),
  ]);
  const row = revision.rows[0];
  return row ? revisionResponse(row, files.rows) : null;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function violatedConstraint(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' ? (e.constraint ?? null) : null;
}

/** Turn a unique-index violation into the code the UI can act on, or null when
 *  it is not one. The production indexes are covered as well as the name ones:
 *  the row lock below should make them unreachable, but a 500 is the wrong
 *  answer if it ever is not. */
function duplicateCode(err: unknown): string | null {
  switch (violatedConstraint(err)) {
    case 'ux_document_revisions_pdt_name':
    case 'ux_document_revisions_spdt_name':
      return ErrorCodes.DOCUMENT_REVISION_NAME_ALREADY_EXISTS;
    case 'ux_document_revisions_pdt_production':
    case 'ux_document_revisions_spdt_production':
      return ErrorCodes.DOCUMENT_REVISION_PRODUCTION_CONFLICT;
    default:
      return null;
  }
}

/**
 * Serialise everything that touches one card's versions.
 *
 * Without it two concurrent promotions both find the production slot already
 * cleared by the other's demotion, both claim it, and the partial unique index
 * rejects the loser with a bare 23505. Taken before the version row's own lock
 * so the lock order is always card-then-row.
 */
async function lockCard(client: PoolClient, scope: DocumentScope, documentTypeId: number) {
  await client.query(`SELECT 1 FROM ${documentTypeTableFor(scope)} WHERE id = $1 FOR UPDATE`, [
    documentTypeId,
  ]);
}

/**
 * Clear the way for a `production` version on this card by deprecating whichever
 * one currently holds the slot. Must run before the insert/update that claims
 * it, or the partial unique index rejects the statement.
 *
 * Returns the change-log entries for the demotion — empty when the slot was
 * free. Building them here rather than at the two call sites keeps the demotion
 * and its audit trail from drifting apart.
 */
async function demoteCurrentProduction(
  client: PoolClient,
  owner: RevisionOwner,
  exceptId: number | null,
): Promise<AuditEvent[]> {
  const result = await client.query<{ name: string }>(
    `UPDATE document_revisions
        SET status = 'deprecated', updated_at = NOW()
      WHERE ${revisionColumnFor(owner.scope)} = $1
        AND status = 'production'
        AND ($2::int IS NULL OR id <> $2)
      RETURNING name`,
    [owner.documentTypeId, exceptId],
  );
  return result.rows.map((row) => ({
    type: 'document_revision',
    tag: 'changed',
    label: row.name,
    scope: revisionScope(owner),
    from: 'production',
    to: 'deprecated',
  }));
}

/** Where a version event happened, as a change-log breadcrumb. A product-scoped
 *  card sits directly under the logged product, so it needs no first hop. */
function revisionScope(owner: RevisionOwner) {
  const card = { type: 'document_type', label: owner.documentTypeName };
  return owner.scope === 'product'
    ? [card]
    : [{ type: 'sub_product', label: owner.entity.name }, card];
}

/**
 * Record version changes in the owning PRODUCT's change log, so they show up
 * beside every other change to the product rather than in a log of their own.
 * A card under a sub-product with no parent product has nowhere to go and is
 * skipped.
 */
async function logRevisionEvents(
  client: PoolClient,
  owner: RevisionOwner,
  userId: number | null | undefined,
  events: AuditEvent[],
): Promise<void> {
  const product = ownerProduct(owner);
  if (events.length === 0 || product === null) return;
  const actor = await resolveActor(client, userId);
  await logAudit(client, 'product', product.id, 'updated', { events }, actor);
}

/** The human-readable summary of a version, for change-log from/to cells. */
function revisionDetails(status: string, releaseNotes: string | null): string {
  return releaseNotes ? `${status} — ${releaseNotes}` : status;
}

/**
 * Resolve the card a request names, rejecting anything that is not a versioned
 * one. Returns null after responding, so callers `if (!owner) return;`.
 */
async function requireRevisionCard(
  res: Response,
  scope: DocumentScope,
  documentTypeId: number,
): Promise<RevisionOwner | null> {
  const owner = await findRevisionOwnerByType(pool, scope, documentTypeId);
  if (!owner) {
    res.status(404).json({ code: ErrorCodes.DOCUMENT_TYPE_NOT_FOUND });
    return null;
  }
  if (!owner.revisionMode) {
    res.status(400).json({ code: ErrorCodes.DOCUMENT_TYPE_NOT_REVISION_MODE });
    return null;
  }
  return owner;
}

// ── Version CRUD ───────────────────────────────────────────────────────────

/** Both families' list/create routes, over one scope. */
function registerCardRoutes(scope: DocumentScope, itemBase: string) {
  router.get(`/${itemBase}/:id/revisions`, requireAuth, async (req, res) => {
    const documentTypeId = requireId(res, req.params.id, ErrorCodes.INVALID_DOCUMENT_TYPE_ID);
    if (documentTypeId === null) return;

    const owner = await requireRevisionCard(res, scope, documentTypeId);
    if (!owner) return;

    res.json({ revisions: await listRevisions(scope, documentTypeId) });
  });

  router.post(`/${itemBase}/:id/revisions`, requireAuth, async (req, res) => {
    const documentTypeId = requireId(res, req.params.id, ErrorCodes.INVALID_DOCUMENT_TYPE_ID);
    if (documentTypeId === null) return;

    const data: DocumentRevisionPayload = documentRevisionPayloadSchema.parse(req.body ?? {});
    const owner = await requireRevisionCard(res, scope, documentTypeId);
    if (!owner) return;

    let newRevisionId: number;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockCard(client, scope, documentTypeId);

      const events: AuditEvent[] = [];
      if (data.status === 'production') {
        events.push(...(await demoteCurrentProduction(client, owner, null)));
      }

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO document_revisions
           (${revisionColumnFor(scope)}, name, status, release_notes, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [documentTypeId, data.name, data.status, data.releaseNotes, req.user?.id ?? null],
      );
      newRevisionId = inserted.rows[0].id;

      events.push({
        type: 'document_revision',
        tag: 'added',
        label: data.name,
        scope: revisionScope(owner),
        to: revisionDetails(data.status, data.releaseNotes),
      });
      await logRevisionEvents(client, owner, req.user?.id, events);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      const code = duplicateCode(err);
      if (code) return res.status(409).json({ code });
      throw err;
    } finally {
      client.release();
    }

    // Reloaded only after the client is back in the pool: `loadRevision` checks
    // one out itself, and holding two per request deadlocks the pool under
    // concurrency. Outside the `catch` for a second reason — a read failing here
    // must not issue a ROLLBACK against an already-committed transaction.
    res.status(201).json(await loadRevision(scope, newRevisionId));
  });
}

registerCardRoutes('product', 'product-document-types');
registerCardRoutes('subProduct', 'sub-product-document-types');

// PUT /api/document-revisions/:id
router.put('/document-revisions/:id', requireAuth, async (req, res) => {
  const revisionId = requireId(res, req.params.id, ErrorCodes.INVALID_DOCUMENT_REVISION_ID);
  if (revisionId === null) return;

  const data: DocumentRevisionPayload = documentRevisionPayloadSchema.parse(req.body ?? {});
  const owner = await findRevisionOwner(pool, revisionId);
  if (!owner) return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_NOT_FOUND });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockCard(client, owner.scope, owner.documentTypeId);

    const before = await client.query<{
      name: string;
      status: string;
      release_notes: string | null;
    }>(`SELECT name, status, release_notes FROM document_revisions WHERE id = $1 FOR UPDATE`, [
      revisionId,
    ]);
    const previous = before.rows[0];
    if (!previous) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_NOT_FOUND });
    }

    const events: AuditEvent[] = [];
    if (data.status === 'production' && previous.status !== 'production') {
      events.push(...(await demoteCurrentProduction(client, owner, revisionId)));
    }

    await client.query(
      `UPDATE document_revisions
          SET name = $2, status = $3, release_notes = $4, updated_at = NOW()
        WHERE id = $1`,
      [revisionId, data.name, data.status, data.releaseNotes],
    );

    const changed =
      previous.name !== data.name ||
      previous.status !== data.status ||
      (previous.release_notes ?? null) !== data.releaseNotes;
    if (changed) {
      events.push({
        type: 'document_revision',
        tag: 'changed',
        label: data.name,
        scope: revisionScope(owner),
        from: revisionDetails(previous.status, previous.release_notes),
        to: revisionDetails(data.status, data.releaseNotes),
      });
    }
    await logRevisionEvents(client, owner, req.user?.id, events);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    const code = duplicateCode(err);
    if (code) return res.status(409).json({ code });
    throw err;
  } finally {
    client.release();
  }

  // After `client.release()` — see the create handler above.
  res.json(await loadRevision(owner.scope, revisionId));
});

// DELETE /api/document-revisions/:id
router.delete('/document-revisions/:id', requireAuth, async (req, res) => {
  const revisionId = requireId(res, req.params.id, ErrorCodes.INVALID_DOCUMENT_REVISION_ID);
  if (revisionId === null) return;

  const owner = await findRevisionOwner(pool, revisionId);
  if (!owner) return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_NOT_FOUND });

  let storageKeys: string[];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Before the DELETE: the cascade takes the file rows with it, and their
    // keys are the only thing that locates the bytes on disk.
    storageKeys = await listRevisionFileKeys(client, [revisionId]);

    const deleted = await client.query<{ id: number }>(
      `DELETE FROM document_revisions WHERE id = $1 RETURNING id`,
      [revisionId],
    );
    if (deleted.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_NOT_FOUND });
    }

    await logRevisionEvents(client, owner, req.user?.id, [
      {
        type: 'document_revision',
        tag: 'removed',
        label: owner.revisionName,
        scope: revisionScope(owner),
      },
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  removeRevisionFiles(owner, [revisionId], storageKeys);
  res.json({ id: revisionId, deleted: true });
});

// ── Version files ──────────────────────────────────────────────────────────

// POST /api/document-revisions/:id/files — multipart, several files at a time
router.post('/document-revisions/:id/files', requireAuth, uploadFiles, async (req, res) => {
  const revisionId = requireId(res, req.params.id, ErrorCodes.INVALID_DOCUMENT_REVISION_ID);
  if (revisionId === null) {
    discardUploads(req);
    return;
  }

  const files = uploadedFiles(req);
  if (files.length === 0) return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });

  const { names } = parseUploadBody(req);

  // Both depend only on `revisionId`, so they go together. Which storage keys
  // already exist decides two things below: whether the change log calls an
  // upload an addition or a replacement, and — more importantly — which files
  // may be unlinked if the transaction fails. An upload that overwrote an
  // existing file has already destroyed the old bytes, so unlinking it on
  // rollback would leave a surviving row pointing at nothing; only genuinely
  // new files can be taken back.
  const [owner, existing] = await Promise.all([
    findRevisionOwner(pool, revisionId),
    query<{ storage_key: string }>(
      `SELECT storage_key FROM document_revision_files WHERE document_revision_id = $1`,
      [revisionId],
    ),
  ]);
  if (!owner) {
    discardUploads(req);
    return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_NOT_FOUND });
  }
  const existingKeys = new Set(existing.rows.map((row) => row.storage_key));

  if (extensionRejected(owner, files)) {
    discardUploads(req);
    return res.status(400).json({ code: ErrorCodes.DOCUMENT_EXTENSION_NOT_ALLOWED });
  }

  // A sub-product's folder lives inside its parent product's tree, so a
  // parentless one has nowhere to put the file. Only possible on data predating
  // migration 014, which made the parent required.
  if (!ownerProduct(owner)) {
    discardUploads(req);
    return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
  }

  // Resolved once, not per file: it walks and creates several directory levels.
  const folder = ensureRevisionDir(owner, { id: revisionId, name: owner.revisionName });

  // Placement runs outside the transaction below, so it needs its own cleanup:
  // a throw part-way (an over-long name is the reachable case) would otherwise
  // leave the already-moved files in the version folder with no row and no
  // sweeper — `_tmp` is the only thing tmpSweeper reclaims.
  const placed: { file: Express.Multer.File; storageKey: string; originalName: string }[] = [];
  try {
    files.forEach((file, index) => {
      placed.push({ file, ...placeRevisionFile(file, folder, names[index]) });
    });
  } catch (err) {
    for (const item of placed) {
      if (!existingKeys.has(item.storageKey)) unlinkRevisionFile(item.storageKey);
    }
    discardUploads(req);
    throw err;
  }

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
      // updated in place rather than duplicated (see `placeRevisionFile`).
      await client.query(
        `INSERT INTO document_revision_files
           (document_revision_id, storage_key, original_name, size_bytes, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (storage_key) DO UPDATE
           SET size_bytes  = EXCLUDED.size_bytes,
               mime_type   = EXCLUDED.mime_type,
               uploaded_by = EXCLUDED.uploaded_by,
               created_at  = NOW()`,
        [
          revisionId,
          item.storageKey,
          item.originalName,
          item.file.size,
          item.file.mimetype,
          req.user?.id ?? null,
        ],
      );
      events.push({
        type: 'document_revision_file',
        tag: existingKeys.has(item.storageKey) ? 'changed' : 'added',
        label: item.originalName,
        scope: [
          ...revisionScope(owner),
          { type: 'document_revision', label: owner.revisionName },
        ],
        to: owner.revisionName,
      });
    }

    await logRevisionEvents(client, owner, req.user?.id, events);
    await client.query('COMMIT');
  } catch (err) {
    await client?.query('ROLLBACK');
    for (const item of placed) {
      if (!existingKeys.has(item.storageKey)) unlinkRevisionFile(item.storageKey);
    }
    throw err;
  } finally {
    client?.release();
  }

  res.status(201).json(await loadRevision(owner.scope, revisionId));
});

// DELETE /api/document-revision-files/:fileId
router.delete('/document-revision-files/:fileId', requireAuth, async (req, res) => {
  const fileId = requireId(res, req.params.fileId, ErrorCodes.INVALID_DOCUMENT_REVISION_FILE_ID);
  if (fileId === null) return;

  let storageKey: string;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query<{
      storage_key: string;
      document_revision_id: number;
      original_name: string;
    }>(
      `DELETE FROM document_revision_files WHERE id = $1
       RETURNING storage_key, document_revision_id, original_name`,
      [fileId],
    );
    const row = deleted.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_FILE_NOT_FOUND });
    }
    storageKey = row.storage_key;

    // Without this the change log shows version files appearing and never
    // disappearing, which misrepresents the current state rather than merely
    // omitting it.
    const owner = await findRevisionOwner(client, row.document_revision_id);
    if (owner) {
      await logRevisionEvents(client, owner, req.user?.id, [
        {
          type: 'document_revision_file',
          tag: 'removed',
          label: row.original_name,
          scope: [
            ...revisionScope(owner),
            { type: 'document_revision', label: owner.revisionName },
          ],
          from: owner.revisionName,
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

  unlinkRevisionFile(storageKey);
  res.json({ id: fileId, deleted: true });
});

// GET /api/document-revision-files/:fileId/download — the ONLY way to read a
// version file: server.ts refuses to serve any path with a `revisions` segment.
router.get('/document-revision-files/:fileId/download', requireAuth, async (req, res) => {
  const fileId = requireId(res, req.params.fileId, ErrorCodes.INVALID_DOCUMENT_REVISION_FILE_ID);
  if (fileId === null) return;

  const result = await query<{
    storage_key: string;
    original_name: string;
    mime_type: string | null;
  }>(
    `SELECT storage_key, original_name, mime_type FROM document_revision_files WHERE id = $1`,
    [fileId],
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_FILE_NOT_FOUND });

  const absolute = resolveRevisionFilePath(row.storage_key);
  if (!absolute || !fs.existsSync(absolute)) {
    return res.status(404).json({ code: ErrorCodes.DOCUMENT_REVISION_FILE_MISSING });
  }
  if (row.mime_type) res.type(row.mime_type);
  return res.download(absolute, row.original_name);
});

export default router;
