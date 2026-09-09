// The Settings type lists — `product_types` and `sub_product_types` — which
// are the same four endpoints over two tables that differ only in their names
// and their error codes. They were two byte-identical files; a change to one
// was always a change to the other, so they are one router now, configured
// twice.
//
// `table` is interpolated into the SQL because a table name cannot be a bind
// parameter. It is a literal from the two configs below and never touches
// request data — the same device `documentTypes.ts` uses for its pair.
import { Router } from 'express';
import { query, isUniqueViolation, isForeignKeyViolation } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError } from '../apiError.js';
import type { ErrorCode } from '../errorCodes.js';
import { typePayloadSchema } from '../schemas/entityTypes.schema.js';
import { requireId } from './routeParams.js';

export interface TypeRouterConfig {
  table: 'product_types' | 'sub_product_types';
  codes: {
    invalidId: ErrorCode;
    notFound: ErrorCode;
    alreadyExists: ErrorCode;
    /** Still assigned to a product or sub-product, so the FK refuses. */
    inUse: ErrorCode;
  };
}

const ROW = `id, name, created_at AS "createdAt"`;

export function createTypeRouter({ table, codes }: TypeRouterConfig): Router {
  const router = Router();

  // Any logged-in user may read the list (it populates the "type" select on
  // the product and sub-product forms); managing it is admin-only.
  router.get('/', requireAuth, async (_req, res) => {
    const result = await query(`SELECT ${ROW} FROM ${table} ORDER BY name ASC`);
    res.json(result.rows);
  });

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const data = typePayloadSchema.parse(req.body);
    try {
      const result = await query(
        `INSERT INTO ${table} (name) VALUES ($1) RETURNING ${ROW}`,
        [data.name],
      );
      res.json(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, codes.alreadyExists);
      throw err;
    }
  });

  router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = requireId(req.params.id, codes.invalidId);
    const data = typePayloadSchema.parse(req.body);
    try {
      // Renaming cascades to the entity's `type` column via the FK's
      // ON UPDATE CASCADE.
      const result = await query(
        `UPDATE ${table} SET name = $1 WHERE id = $2 RETURNING ${ROW}`,
        [data.name, id],
      );
      if (result.rowCount === 0) throw new ApiError(404, codes.notFound);
      res.json(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, codes.alreadyExists);
      throw err;
    }
  });

  router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = requireId(req.params.id, codes.invalidId);
    try {
      const result = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
      if (result.rowCount === 0) throw new ApiError(404, codes.notFound);
      res.json({ id, deleted: true });
    } catch (err) {
      // No ON DELETE clause defaults to RESTRICT, so a type still assigned to
      // a row raises a foreign_key_violation rather than orphaning it.
      if (isForeignKeyViolation(err)) throw new ApiError(409, codes.inUse);
      throw err;
    }
  });

  return router;
}
