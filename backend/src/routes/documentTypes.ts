// Template management API (document-system-plan.md, Story 3): CRUD + reorder
// for the document requirement lists that the Documents panel (Story 5/6)
// renders as cards. Mirrors the two-sections-in-one-file layout of
// documents.ts — product and sub-product document types are structurally
// identical, just pointed at different tables.
//
// A template is scoped either to a TYPE (managed from the settings page, and
// inherited by every product of that type) or to a single product /
// sub-product (added from that entity's Documents panel; migration 016). The
// update and delete routes are shared: both take a template id, and neither
// cares which scope the row it names belongs to.
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

const router = Router();

/** The columns every route below returns, aliased to one shape. `type_id` and
 *  `entity_id` are mutually exclusive — see the table's scope CHECK. */
function returnedColumns(typeColumn: string, entityColumn: string): string {
  return `id, ${typeColumn} AS type_id, ${entityColumn} AS entity_id, name, icon,
          allowed_extensions, required, sort_order, created_at`;
}

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

// ── Entity-scoped creation ─────────────────────────────────────────────────

/** Table wiring for one family's entity-scoped templates. Read only from the
 *  literal below, never from request input, so interpolation is safe. */
interface EntityScopeConfig {
  entityTable: string;
  typeTable: string;
  documentTypeTable: string;
  typeColumn: string;
  entityColumn: string;
  /** The owning product / sub-product does not exist. */
  entityNotFound: string;
  /** The template id does not exist. */
  templateNotFound: string;
  alreadyExists: string;
}

const ENTITY_SCOPES = {
  product: {
    entityTable: 'products',
    typeTable: 'product_types',
    documentTypeTable: 'product_document_types',
    typeColumn: 'product_type_id',
    entityColumn: 'product_id',
    entityNotFound: ErrorCodes.PRODUCT_NOT_FOUND,
    templateNotFound: ErrorCodes.PRODUCT_DOCUMENT_TYPE_NOT_FOUND,
    alreadyExists: ErrorCodes.PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS,
  },
  subProduct: {
    entityTable: 'sub_products',
    typeTable: 'sub_product_types',
    documentTypeTable: 'sub_product_document_types',
    typeColumn: 'sub_product_type_id',
    entityColumn: 'sub_product_id',
    entityNotFound: ErrorCodes.SUB_PRODUCT_NOT_FOUND,
    templateNotFound: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_NOT_FOUND,
    alreadyExists: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS,
  },
} satisfies Record<string, EntityScopeConfig>;

/**
 * Would this name give the entity's panel two identically-named cards?
 *
 * The partial unique indexes police each scope on its own; a card the entity
 * defines itself colliding with one it INHERITS from its type spans a join, so
 * no constraint can express it. Checked here rather than in the settings
 * routes on purpose: this is where the admin is looking straight at the cards
 * they would be duplicating, and the answer is actionable. A type-wide
 * addition is deliberately not blocked by one entity's local card.
 */
async function nameTaken(
  config: EntityScopeConfig,
  entityId: number,
  name: string,
  excludeId: number | null = null,
): Promise<boolean> {
  const { entityTable, typeTable, documentTypeTable, typeColumn, entityColumn } = config;
  const result = await query(
    `SELECT 1 FROM ${documentTypeTable} dt
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

/** Create a document type belonging to one entity rather than to its type. */
async function createForEntity(
  res: Response,
  config: EntityScopeConfig,
  entityId: number,
  data: DocumentTypePayload,
) {
  const { entityTable, documentTypeTable, entityColumn, typeColumn } = config;

  const exists = await query(`SELECT 1 FROM ${entityTable} WHERE id = $1`, [entityId]);
  if (exists.rowCount === 0) return res.status(404).json({ code: config.entityNotFound });

  if (await nameTaken(config, entityId, data.name)) {
    return res.status(409).json({ code: config.alreadyExists });
  }

  try {
    // sort_order counts only the entity's OWN templates; inherited ones have
    // their own sequence and the two are separated by the panel's ordering
    // (see documentTypesQuery), never interleaved by number.
    const result = await query<DocumentTypeDbRow>(
      `INSERT INTO ${documentTypeTable}
         (${entityColumn}, name, icon, allowed_extensions, required, sort_order)
       VALUES (
         $1, $2, $3, $4::text[], $5,
         COALESCE((SELECT MAX(sort_order) + 1 FROM ${documentTypeTable}
                   WHERE ${entityColumn} = $1), 0)
       )
       RETURNING ${returnedColumns(typeColumn, entityColumn)}`,
      [entityId, data.name, data.icon, data.allowedExtensions, data.required],
    );
    return res.status(201).json(documentTypeRow(result.rows[0]));
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === '23505') {
      return res.status(409).json({ code: config.alreadyExists });
    }
    throw err;
  }
}

/**
 * Update one template by id, whichever scope it belongs to — the settings list
 * and an entity's own panel both edit through here.
 *
 * `sort_order` is intentionally left untouched: only the reorder endpoints
 * change ordering.
 */
async function updateTemplate(
  res: Response,
  config: EntityScopeConfig,
  id: number,
  data: DocumentTypePayload,
) {
  const { documentTypeTable, typeColumn, entityColumn } = config;

  const existing = await query<{ entity_id: number | null }>(
    `SELECT ${entityColumn} AS entity_id FROM ${documentTypeTable} WHERE id = $1`,
    [id],
  );
  if (existing.rowCount === 0) {
    return res.status(404).json({ code: config.templateNotFound });
  }

  // Only meaningful for an entity-scoped row; a type-scoped one is covered by
  // its partial unique index alone (see nameTaken).
  const entityId = existing.rows[0].entity_id;
  if (entityId !== null && (await nameTaken(config, entityId, data.name, id))) {
    return res.status(409).json({ code: config.alreadyExists });
  }

  try {
    const result = await query<DocumentTypeDbRow>(
      `UPDATE ${documentTypeTable}
       SET name = $1, icon = $2, allowed_extensions = $3::text[], required = $4
       WHERE id = $5
       RETURNING ${returnedColumns(typeColumn, entityColumn)}`,
      [data.name, data.icon, data.allowedExtensions, data.required, id],
    );
    return res.json(documentTypeRow(result.rows[0]));
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === '23505') {
      return res.status(409).json({ code: config.alreadyExists });
    }
    throw err;
  }
}

// POST /api/products/:productId/document-types — a card for this product only
router.post('/products/:productId/document-types', requireAuth, requireAdmin, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const data = documentTypePayloadSchema.parse(req.body);
  return createForEntity(res, ENTITY_SCOPES.product, productId, data);
});

// POST /api/sub-products/:spId/document-types — a card for this sub-product only
router.post('/sub-products/:spId/document-types', requireAuth, requireAdmin, async (req, res) => {
  const spId = Number(req.params.spId);
  if (!spId || Number.isNaN(spId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
  }
  const data = documentTypePayloadSchema.parse(req.body);
  return createForEntity(res, ENTITY_SCOPES.subProduct, spId, data);
});

// ── Product document types ──────────────────────────────────────────────────

const PRODUCT_COLUMNS = returnedColumns('product_type_id', 'product_id');

// GET /api/product-types/:typeId/document-types — the type's own templates.
// Cards a single product defines for itself are deliberately absent: this is
// the settings list, and they are managed from that product's panel.
router.get('/product-types/:typeId/document-types', requireAuth, async (req, res) => {
  const typeId = Number(req.params.typeId);
  if (!typeId || Number.isNaN(typeId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
  }
  const result = await query<DocumentTypeDbRow>(
    `SELECT ${PRODUCT_COLUMNS}
     FROM product_document_types
     WHERE product_type_id = $1
     ORDER BY sort_order ASC, name ASC`,
    [typeId],
  );
  res.json(result.rows.map(documentTypeRow));
});

// POST /api/product-types/:typeId/document-types
router.post(
  '/product-types/:typeId/document-types',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
    }
    const data = documentTypePayloadSchema.parse(req.body);

    const typeExists = await query(`SELECT 1 FROM product_types WHERE id = $1`, [typeId]);
    if (typeExists.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.PRODUCT_TYPE_NOT_FOUND });
    }

    try {
      const result = await query<DocumentTypeDbRow>(
        `INSERT INTO product_document_types
           (product_type_id, name, icon, allowed_extensions, required, sort_order)
         VALUES (
           $1, $2, $3, $4::text[], $5,
           COALESCE((SELECT MAX(sort_order) + 1 FROM product_document_types WHERE product_type_id = $1), 0)
         )
         RETURNING ${PRODUCT_COLUMNS}`,
        [typeId, data.name, data.icon, data.allowedExtensions, data.required],
      );
      res.status(201).json(documentTypeRow(result.rows[0]));
    } catch (err: any) {
      if (err?.code === '23505') {
        return res.status(409).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS });
      }
      throw err;
    }
  },
);

// PUT /api/product-types/:typeId/document-types/reorder — full ordered id list
// for that type; array position becomes sort_order. Placed before the plain
// "/:id" routes below so "reorder" is never captured as a document-type id.
router.put(
  '/product-types/:typeId/document-types/reorder',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
    }
    const data = documentTypeReorderSchema.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM product_document_types WHERE product_type_id = $1`,
        [typeId],
      );
      const existingIds = new Set(existing.rows.map((r) => r.id));
      const incomingIds = new Set(data.orderedIds);
      const sameSet =
        existingIds.size === incomingIds.size &&
        [...existingIds].every((id) => incomingIds.has(id));

      if (!sameSet) {
        await client.query('ROLLBACK');
        return res.status(400).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_REORDER_MISMATCH });
      }

      for (let sortOrder = 0; sortOrder < data.orderedIds.length; sortOrder++) {
        await client.query(
          `UPDATE product_document_types SET sort_order = $1
           WHERE id = $2 AND product_type_id = $3`,
          [sortOrder, data.orderedIds[sortOrder], typeId],
        );
      }

      const result = await client.query<DocumentTypeDbRow>(
        `SELECT ${PRODUCT_COLUMNS}
         FROM product_document_types
         WHERE product_type_id = $1
         ORDER BY sort_order ASC, name ASC`,
        [typeId],
      );

      await client.query('COMMIT');
      res.json(result.rows.map(documentTypeRow));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

// PUT /api/product-document-types/:id — type-scoped and product-scoped alike
router.put('/product-document-types/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_DOCUMENT_TYPE_ID });
  }
  const data = documentTypePayloadSchema.parse(req.body);
  return updateTemplate(res, ENTITY_SCOPES.product, id, data);
});

// DELETE /api/product-document-types/:id — never destroys files: the FK's
// ON DELETE SET NULL demotes any referencing product_revision_documents rows
// to the "Other documents" bucket. The affected-file count lets the UI warn
// before the admin confirms (plan §7 risk 3 / Story 4 AC).
router.delete('/product-document-types/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_DOCUMENT_TYPE_ID });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const affected = await client.query(
      `SELECT COUNT(*)::int AS count FROM product_revision_documents WHERE document_type_id = $1`,
      [id],
    );

    const result = await client.query(
      `DELETE FROM product_document_types WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_NOT_FOUND });
    }

    await client.query('COMMIT');
    res.json({ id, deleted: true, filesMovedToOther: affected.rows[0].count });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Sub-product document types ──────────────────────────────────────────────

const SUB_PRODUCT_COLUMNS = returnedColumns('sub_product_type_id', 'sub_product_id');

// GET /api/sub-product-types/:typeId/document-types
router.get('/sub-product-types/:typeId/document-types', requireAuth, async (req, res) => {
  const typeId = Number(req.params.typeId);
  if (!typeId || Number.isNaN(typeId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
  }
  const result = await query<DocumentTypeDbRow>(
    `SELECT ${SUB_PRODUCT_COLUMNS}
     FROM sub_product_document_types
     WHERE sub_product_type_id = $1
     ORDER BY sort_order ASC, name ASC`,
    [typeId],
  );
  res.json(result.rows.map(documentTypeRow));
});

// POST /api/sub-product-types/:typeId/document-types
router.post(
  '/sub-product-types/:typeId/document-types',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
    }
    const data = documentTypePayloadSchema.parse(req.body);

    const typeExists = await query(`SELECT 1 FROM sub_product_types WHERE id = $1`, [typeId]);
    if (typeExists.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_TYPE_NOT_FOUND });
    }

    try {
      const result = await query<DocumentTypeDbRow>(
        `INSERT INTO sub_product_document_types
           (sub_product_type_id, name, icon, allowed_extensions, required, sort_order)
         VALUES (
           $1, $2, $3, $4::text[], $5,
           COALESCE((SELECT MAX(sort_order) + 1 FROM sub_product_document_types WHERE sub_product_type_id = $1), 0)
         )
         RETURNING ${SUB_PRODUCT_COLUMNS}`,
        [typeId, data.name, data.icon, data.allowedExtensions, data.required],
      );
      res.status(201).json(documentTypeRow(result.rows[0]));
    } catch (err: any) {
      if (err?.code === '23505') {
        return res
          .status(409)
          .json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS });
      }
      throw err;
    }
  },
);

// PUT /api/sub-product-types/:typeId/document-types/reorder
router.put(
  '/sub-product-types/:typeId/document-types/reorder',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
    }
    const data = documentTypeReorderSchema.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM sub_product_document_types WHERE sub_product_type_id = $1`,
        [typeId],
      );
      const existingIds = new Set(existing.rows.map((r) => r.id));
      const incomingIds = new Set(data.orderedIds);
      const sameSet =
        existingIds.size === incomingIds.size &&
        [...existingIds].every((id) => incomingIds.has(id));

      if (!sameSet) {
        await client.query('ROLLBACK');
        return res
          .status(400)
          .json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_REORDER_MISMATCH });
      }

      for (let sortOrder = 0; sortOrder < data.orderedIds.length; sortOrder++) {
        await client.query(
          `UPDATE sub_product_document_types SET sort_order = $1
           WHERE id = $2 AND sub_product_type_id = $3`,
          [sortOrder, data.orderedIds[sortOrder], typeId],
        );
      }

      const result = await client.query<DocumentTypeDbRow>(
        `SELECT ${SUB_PRODUCT_COLUMNS}
         FROM sub_product_document_types
         WHERE sub_product_type_id = $1
         ORDER BY sort_order ASC, name ASC`,
        [typeId],
      );

      await client.query('COMMIT');
      res.json(result.rows.map(documentTypeRow));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

// PUT /api/sub-product-document-types/:id
router.put('/sub-product-document-types/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_DOCUMENT_TYPE_ID });
  }
  const data = documentTypePayloadSchema.parse(req.body);
  return updateTemplate(res, ENTITY_SCOPES.subProduct, id, data);
});

// DELETE /api/sub-product-document-types/:id
router.delete(
  '/sub-product-document-types/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_DOCUMENT_TYPE_ID });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const affected = await client.query(
        `SELECT COUNT(*)::int AS count FROM sub_product_revision_documents WHERE document_type_id = $1`,
        [id],
      );

      const result = await client.query(
        `DELETE FROM sub_product_document_types WHERE id = $1 RETURNING id`,
        [id],
      );
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_NOT_FOUND });
      }

      await client.query('COMMIT');
      res.json({ id, deleted: true, filesMovedToOther: affected.rows[0].count });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

export default router;
