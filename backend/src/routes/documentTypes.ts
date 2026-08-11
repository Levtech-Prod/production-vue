// Template management API (document-system-plan.md, Story 3): CRUD + reorder
// for the document requirement lists that the Documents panel (Story 5/6)
// renders as cards.
//
// A template is scoped EITHER to a type (managed from the settings page, and
// inherited by every product of that type) or to a single product /
// sub-product (added from that entity's Documents panel; migration 016).
//
// Product and sub-product templates are structurally identical — same columns,
// same rules, different tables — so every handler here is written once against
// a `ScopeConfig` and the routes are thin wrappers that pick one. The table and
// column names interpolated into the SQL come only from the SCOPES literal
// below, never from request input; all values stay parameterized.
import { Router } from 'express';
import type { Response } from 'express';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  documentTypePayloadSchema,
  documentTypeReorderSchema,
  type DocumentTypePayload,
} from '../schemas/documentTypes.schema.js';
import type { Queryable } from '../services/documentFiles.js';
import { requireId } from './routeParams.js';

const router = Router();

// ── Scope configuration ────────────────────────────────────────────────────

interface ScopeConfig {
  /** The owning product / sub-product table. */
  entityTable: string;
  /** Managed type list the entity's `type` column names. */
  typeTable: string;
  /** The templates themselves. */
  table: string;
  /** Template FK to the type list; NULL on an entity-scoped row. */
  typeColumn: string;
  /** Template FK to a single entity; NULL on a type-scoped row. */
  entityColumn: string;
  /** Per-revision documents, for counting what a delete would demote. */
  revisionDocumentTable: string;
  errors: {
    invalidEntityId: string;
    entityNotFound: string;
    invalidTypeId: string;
    typeNotFound: string;
    invalidTemplateId: string;
    templateNotFound: string;
    alreadyExists: string;
    reorderMismatch: string;
  };
}

const SCOPES = {
  product: {
    entityTable: 'products',
    typeTable: 'product_types',
    table: 'product_document_types',
    typeColumn: 'product_type_id',
    entityColumn: 'product_id',
    revisionDocumentTable: 'product_revision_documents',
    errors: {
      invalidEntityId: ErrorCodes.INVALID_PRODUCT_ID,
      entityNotFound: ErrorCodes.PRODUCT_NOT_FOUND,
      invalidTypeId: ErrorCodes.INVALID_PRODUCT_TYPE_ID,
      typeNotFound: ErrorCodes.PRODUCT_TYPE_NOT_FOUND,
      invalidTemplateId: ErrorCodes.INVALID_PRODUCT_DOCUMENT_TYPE_ID,
      templateNotFound: ErrorCodes.PRODUCT_DOCUMENT_TYPE_NOT_FOUND,
      alreadyExists: ErrorCodes.PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS,
      reorderMismatch: ErrorCodes.PRODUCT_DOCUMENT_TYPE_REORDER_MISMATCH,
    },
  },
  subProduct: {
    entityTable: 'sub_products',
    typeTable: 'sub_product_types',
    table: 'sub_product_document_types',
    typeColumn: 'sub_product_type_id',
    entityColumn: 'sub_product_id',
    revisionDocumentTable: 'sub_product_revision_documents',
    errors: {
      invalidEntityId: ErrorCodes.INVALID_SUB_PRODUCT_ID,
      entityNotFound: ErrorCodes.SUB_PRODUCT_NOT_FOUND,
      invalidTypeId: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID,
      typeNotFound: ErrorCodes.SUB_PRODUCT_TYPE_NOT_FOUND,
      invalidTemplateId: ErrorCodes.INVALID_SUB_PRODUCT_DOCUMENT_TYPE_ID,
      templateNotFound: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_NOT_FOUND,
      alreadyExists: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS,
      reorderMismatch: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_REORDER_MISMATCH,
    },
  },
} satisfies Record<string, ScopeConfig>;

// ── Response shape ─────────────────────────────────────────────────────────

interface DocumentTypeDbRow {
  id: number;
  type_id: number | null;
  entity_id: number | null;
  name: string;
  icon: string;
  allowed_extensions: string[] | null;
  required: boolean;
  sort_order: number;
  created_at: Date;
}

/** The columns every query here returns, aliased to one shape. `type_id` and
 *  `entity_id` are mutually exclusive — see the table's scope CHECK. */
function columns({ typeColumn, entityColumn }: ScopeConfig): string {
  return `id, ${typeColumn} AS type_id, ${entityColumn} AS entity_id, name, icon,
          allowed_extensions, required, sort_order, created_at`;
}

function documentTypeRow(row: DocumentTypeDbRow) {
  return {
    id: row.id,
    typeId: row.type_id,
    name: row.name,
    icon: row.icon,
    allowedExtensions: row.allowed_extensions ?? [],
    required: row.required,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    // Matches the flag the panel payload carries (routes/documents.ts), so the
    // client has one rule for "may I edit this card in place?".
    custom: row.entity_id !== null,
  };
}

/** Postgres unique violation — a name already taken within one scope. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

// ── Type-scoped templates (settings page) ──────────────────────────────────

/** The type's own templates, in display order. Templates a single entity
 *  defines for itself are deliberately absent: this is the settings list, and
 *  those are managed from that entity's Documents panel. */
async function listForType(res: Response, config: ScopeConfig, typeId: number) {
  const result = await query<DocumentTypeDbRow>(
    `SELECT ${columns(config)}
     FROM ${config.table}
     WHERE ${config.typeColumn} = $1
     ORDER BY sort_order ASC, name ASC`,
    [typeId],
  );
  return res.json(result.rows.map(documentTypeRow));
}

async function createForType(
  res: Response,
  config: ScopeConfig,
  typeId: number,
  data: DocumentTypePayload,
) {
  const { table, typeColumn, typeTable, errors } = config;

  const typeExists = await query(`SELECT 1 FROM ${typeTable} WHERE id = $1`, [typeId]);
  if (typeExists.rowCount === 0) return res.status(404).json({ code: errors.typeNotFound });

  try {
    const result = await query<DocumentTypeDbRow>(
      `INSERT INTO ${table}
         (${typeColumn}, name, icon, allowed_extensions, required, sort_order)
       VALUES (
         $1, $2, $3, $4::text[], $5,
         COALESCE((SELECT MAX(sort_order) + 1 FROM ${table} WHERE ${typeColumn} = $1), 0)
       )
       RETURNING ${columns(config)}`,
      [typeId, data.name, data.icon, data.allowedExtensions, data.required],
    );
    return res.status(201).json(documentTypeRow(result.rows[0]));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ code: errors.alreadyExists });
    throw err;
  }
}

/**
 * Apply a full ordered id list to one type's templates; array position becomes
 * `sort_order`. The list must name exactly the templates that type has — a
 * partial list would silently leave the rest at stale positions, so a mismatch
 * is rejected rather than half-applied.
 */
async function reorderForType(
  res: Response,
  config: ScopeConfig,
  typeId: number,
  orderedIds: number[],
) {
  const { table, typeColumn, errors } = config;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: number }>(
      `SELECT id FROM ${table} WHERE ${typeColumn} = $1`,
      [typeId],
    );
    const existingIds = new Set(existing.rows.map((r) => r.id));
    const incomingIds = new Set(orderedIds);
    const sameSet =
      existingIds.size === incomingIds.size && [...existingIds].every((id) => incomingIds.has(id));

    if (!sameSet) {
      await client.query('ROLLBACK');
      return res.status(400).json({ code: errors.reorderMismatch });
    }

    // One statement rather than a round trip per row: `WITH ORDINALITY`
    // numbers the array 1..n, and `- 1` keeps the stored order zero-based.
    await client.query(
      `UPDATE ${table} dt
       SET sort_order = ordered.ord - 1
       FROM unnest($1::int[]) WITH ORDINALITY AS ordered(id, ord)
       WHERE dt.id = ordered.id AND dt.${typeColumn} = $2`,
      [orderedIds, typeId],
    );

    const result = await client.query<DocumentTypeDbRow>(
      `SELECT ${columns(config)}
       FROM ${table}
       WHERE ${typeColumn} = $1
       ORDER BY sort_order ASC, name ASC`,
      [typeId],
    );

    await client.query('COMMIT');
    return res.json(result.rows.map(documentTypeRow));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Entity-scoped templates (Documents panel) ──────────────────────────────

/**
 * Would this name give the entity's panel two identically-named cards?
 *
 * The partial unique indexes police each scope on its own; a card the entity
 * defines itself colliding with one it INHERITS from its type spans a join, so
 * no index can express it. Checked here rather than in the type-scoped routes
 * on purpose: this is where the admin is looking straight at the cards they
 * would be duplicating, and the answer is actionable. A type-wide addition is
 * deliberately not blocked by one entity's local card.
 *
 * Case-insensitive, matching the `LOWER(name)` indexes (migration 016).
 */
async function nameTaken(
  db: Queryable,
  config: ScopeConfig,
  entityId: number,
  name: string,
  excludeId: number | null = null,
): Promise<boolean> {
  const { entityTable, typeTable, table, typeColumn, entityColumn } = config;
  const result = await db.query(
    `SELECT 1 FROM ${table} dt
     LEFT JOIN ${typeTable} t ON t.id = dt.${typeColumn}
     WHERE LOWER(dt.name) = LOWER($2)
       AND ($3::int IS NULL OR dt.id <> $3)
       AND (
         dt.${entityColumn} = $1
         OR t.name = (SELECT type FROM ${entityTable} WHERE id = $1)
       )
     LIMIT 1`,
    [entityId, name, excludeId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Create a template belonging to one entity rather than to its type. */
async function createForEntity(
  res: Response,
  config: ScopeConfig,
  entityId: number,
  data: DocumentTypePayload,
) {
  const { entityTable, table, entityColumn, errors } = config;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE, so two concurrent creates on the same entity serialise. The
    // unique index catches a same-scope duplicate on its own, but the
    // cross-scope check above it is a read followed by a write, and without
    // the lock both requests could pass it and both insert.
    const entity = await client.query(
      `SELECT 1 FROM ${entityTable} WHERE id = $1 FOR UPDATE`,
      [entityId],
    );
    if (entity.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: errors.entityNotFound });
    }

    if (await nameTaken(client, config, entityId, data.name)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: errors.alreadyExists });
    }

    // sort_order counts only the entity's OWN templates; inherited ones have
    // their own sequence and the two are separated by the panel's ordering
    // (see documentTypesQuery), never interleaved by number.
    const result = await client.query<DocumentTypeDbRow>(
      `INSERT INTO ${table}
         (${entityColumn}, name, icon, allowed_extensions, required, sort_order)
       VALUES (
         $1, $2, $3, $4::text[], $5,
         COALESCE((SELECT MAX(sort_order) + 1 FROM ${table} WHERE ${entityColumn} = $1), 0)
       )
       RETURNING ${columns(config)}`,
      [entityId, data.name, data.icon, data.allowedExtensions, data.required],
    );

    await client.query('COMMIT');
    return res.status(201).json(documentTypeRow(result.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) return res.status(409).json({ code: errors.alreadyExists });
    throw err;
  } finally {
    client.release();
  }
}

// ── By template id (either scope) ──────────────────────────────────────────

/**
 * Update one template, whichever scope it belongs to — the settings list and an
 * entity's own panel both edit through here.
 *
 * `sort_order` is intentionally left untouched: only reorder changes ordering.
 */
async function updateTemplate(
  res: Response,
  config: ScopeConfig,
  id: number,
  data: DocumentTypePayload,
) {
  const { table, entityColumn, errors } = config;

  const existing = await query<{ entity_id: number | null }>(
    `SELECT ${entityColumn} AS entity_id FROM ${table} WHERE id = $1`,
    [id],
  );
  if (existing.rowCount === 0) return res.status(404).json({ code: errors.templateNotFound });

  // Only meaningful for an entity-scoped row; a type-scoped one is covered by
  // its partial unique index alone (see nameTaken).
  const entityId = existing.rows[0].entity_id;
  if (entityId !== null && (await nameTaken(pool, config, entityId, data.name, id))) {
    return res.status(409).json({ code: errors.alreadyExists });
  }

  try {
    const result = await query<DocumentTypeDbRow>(
      `UPDATE ${table}
       SET name = $1, icon = $2, allowed_extensions = $3::text[], required = $4
       WHERE id = $5
       RETURNING ${columns(config)}`,
      [data.name, data.icon, data.allowedExtensions, data.required, id],
    );
    return res.json(documentTypeRow(result.rows[0]));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ code: errors.alreadyExists });
    throw err;
  }
}

/**
 * Delete one template. Never destroys files: the FK's ON DELETE SET NULL
 * demotes any referencing revision-document rows to the "Other documents"
 * bucket. The affected-file count lets the UI say what just happened (plan §7
 * risk 3 / Story 4 AC).
 */
async function deleteTemplate(res: Response, config: ScopeConfig, id: number) {
  const { table, revisionDocumentTable, errors } = config;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const affected = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${revisionDocumentTable} WHERE document_type_id = $1`,
      [id],
    );

    const result = await client.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: errors.templateNotFound });
    }

    await client.query('COMMIT');
    return res.json({ id, deleted: true, filesMovedToOther: affected.rows[0].count });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────
//
// Registered per family rather than looped, so every URL this API serves is
// greppable as a literal. Each one only parses its id and picks a scope.

/**
 * Both families' routes, over one scope. `typeBase` / `entityBase` / `itemBase`
 * are the three URL segments that differ between them.
 */
function registerRoutes(
  config: ScopeConfig,
  paths: { typeBase: string; entityBase: string; itemBase: string },
) {
  const { typeBase, entityBase, itemBase } = paths;
  const { errors } = config;

  // GET /api/<typeBase>/:typeId/document-types
  router.get(`/${typeBase}/:typeId/document-types`, requireAuth, async (req, res) => {
    const typeId = requireId(res, req.params.typeId, errors.invalidTypeId);
    if (typeId === null) return;
    return listForType(res, config, typeId);
  });

  // POST /api/<typeBase>/:typeId/document-types
  router.post(`/${typeBase}/:typeId/document-types`, requireAuth, requireAdmin, async (req, res) => {
    const typeId = requireId(res, req.params.typeId, errors.invalidTypeId);
    if (typeId === null) return;
    return createForType(res, config, typeId, documentTypePayloadSchema.parse(req.body));
  });

  // PUT /api/<typeBase>/:typeId/document-types/reorder — registered before the
  // "/:id" routes so "reorder" is never captured as a template id.
  router.put(
    `/${typeBase}/:typeId/document-types/reorder`,
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const typeId = requireId(res, req.params.typeId, errors.invalidTypeId);
      if (typeId === null) return;
      const data = documentTypeReorderSchema.parse(req.body);
      return reorderForType(res, config, typeId, data.orderedIds);
    },
  );

  // POST /api/<entityBase>/:entityId/document-types — a card for this one
  // product / sub-product, added from its Documents panel.
  router.post(
    `/${entityBase}/:entityId/document-types`,
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const entityId = requireId(res, req.params.entityId, errors.invalidEntityId);
      if (entityId === null) return;
      return createForEntity(res, config, entityId, documentTypePayloadSchema.parse(req.body));
    },
  );

  // PUT /api/<itemBase>/:id — type-scoped and entity-scoped alike
  router.put(`/${itemBase}/:id`, requireAuth, requireAdmin, async (req, res) => {
    const id = requireId(res, req.params.id, errors.invalidTemplateId);
    if (id === null) return;
    return updateTemplate(res, config, id, documentTypePayloadSchema.parse(req.body));
  });

  // DELETE /api/<itemBase>/:id
  router.delete(`/${itemBase}/:id`, requireAuth, requireAdmin, async (req, res) => {
    const id = requireId(res, req.params.id, errors.invalidTemplateId);
    if (id === null) return;
    return deleteTemplate(res, config, id);
  });
}

registerRoutes(SCOPES.product, {
  typeBase: 'product-types',
  entityBase: 'products',
  itemBase: 'product-document-types',
});

registerRoutes(SCOPES.subProduct, {
  typeBase: 'sub-product-types',
  entityBase: 'sub-products',
  itemBase: 'sub-product-document-types',
});

export default router;
