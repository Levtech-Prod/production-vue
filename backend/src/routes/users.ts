import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (_req, res) => {
  const result = await query(
    `SELECT id, username, email, phone, admin, created_at AS "createdAt"
     FROM users
     ORDER BY created_at DESC`
  );
  res.json(result.rows);
});

export default router;
