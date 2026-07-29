import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import { companyPayloadSchema } from '../schemas/companies.schema.js';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT id, name, created_at AS "createdAt" FROM companies ORDER BY name ASC`,
  );
  res.json(result.rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const data = companyPayloadSchema.parse(req.body);
  try {
    const result = await query(
      `INSERT INTO companies (name) VALUES ($1)
       RETURNING id, name, created_at AS "createdAt"`,
      [data.name],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ code: ErrorCodes.COMPANY_ALREADY_EXISTS });
    }
    throw err;
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_COMPANY_ID });
  }
  try {
    const result = await query(
      `DELETE FROM companies WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.COMPANY_NOT_FOUND });
    }
    res.json({ id });
  } catch (err: any) {
    if (err?.code === '23503') {
      // FK violation: company is referenced by stock_entries
      return res.status(409).json({ code: ErrorCodes.COMPANY_DELETE_FAILED });
    }
    throw err;
  }
});

export default router;
