import { Router } from 'express';
import { query, isUniqueViolation, isForeignKeyViolation } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import { companyPayloadSchema } from '../schemas/companies.schema.js';
import { requireId } from './routeParams.js';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT id, name, created_at AS "createdAt" FROM companies ORDER BY name ASC`,
  );
  res.json(result.rows);
});

// Every logged-in user, not admins only (§8.5): the offer grid lets a salesman
// add a supplier that is not in the list yet while quoting, and the same inline
// creation already sits in the stock entry form. Creating a name is harmless
// and reversible — the DELETE below, which can strand stock entries and
// orders, is not, and stays admin-only.
router.post('/', requireAuth, async (req, res) => {
  const data = companyPayloadSchema.parse(req.body);
  try {
    const result = await query(
      `INSERT INTO companies (name) VALUES ($1)
       RETURNING id, name, created_at AS "createdAt"`,
      [data.name],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, ErrorCodes.COMPANY_ALREADY_EXISTS);
    throw err;
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = requireId(req.params.id, ErrorCodes.INVALID_COMPANY_ID);
  try {
    const result = await query(`DELETE FROM companies WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) throw new ApiError(404, ErrorCodes.COMPANY_NOT_FOUND);
    res.json({ id });
  } catch (err) {
    // Referenced by stock_entries, which have no ON DELETE clause.
    if (isForeignKeyViolation(err)) throw new ApiError(409, ErrorCodes.COMPANY_DELETE_FAILED);
    throw err;
  }
});

export default router;
