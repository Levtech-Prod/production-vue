import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  parameters: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(['text', 'number', 'boolean']).default('text'),
    unit: z.string().optional().nullable(),
    required: z.boolean().default(false)
  })).default([])
});

router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT
      pc.id,
      pc.name,
      pc.description,
      pc.image,
      pc.created_at AS "createdAt",
      COALESCE(
        json_agg(
          json_build_object(
            'id', pcp.id,
            'categoryId', pcp.category_id,
            'name', pcp.name,
            'type', pcp.type,
            'unit', pcp.unit,
            'required', pcp.required,
            'createdAt', pcp.created_at
          ) ORDER BY pcp.id
        ) FILTER (WHERE pcp.id IS NOT NULL),
        '[]'
      ) AS parameters
     FROM part_categories pc
     LEFT JOIN part_category_parameters pcp ON pcp.category_id = pc.id
     GROUP BY pc.id
     ORDER BY pc.name ASC`
  );
  res.json(result.rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const data = schema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryResult = await client.query(
      `INSERT INTO part_categories (name, description, image)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, image, created_at AS "createdAt"`,
      [data.name, data.description || null, data.image || null]
    );
    const category = categoryResult.rows[0];
    const parameters = [];
    for (const p of data.parameters) {
      const pResult = await client.query(
        `INSERT INTO part_category_parameters (category_id, name, type, unit, required)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, category_id AS "categoryId", name, type, unit, required, created_at AS "createdAt"`,
        [category.id, p.name, p.type, p.unit || null, p.required]
      );
      parameters.push(pResult.rows[0]);
    }
    await client.query('COMMIT');
    res.json({ ...category, parameters });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
