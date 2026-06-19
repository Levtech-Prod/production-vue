import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
const schema = z.object({
  categoryId: z.number(),
  name: z.string().min(2),
  pricePerPiece: z.number().nonnegative(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  parameters: z.array(z.object({ parameterId: z.number(), value: z.string() })).default([])
});

router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT
      p.id,
      p.category_id AS "categoryId",
      p.name,
      p.price_per_piece AS "pricePerPiece",
      p.location,
      p.description,
      p.created_at AS "createdAt",
      p.updated_at AS "updatedAt",
      json_build_object('id', pc.id, 'name', pc.name, 'description', pc.description, 'image', pc.image) AS category,
      COALESCE(
        json_agg(
          json_build_object(
            'id', sp.id,
            'partId', sp.part_id,
            'parameterId', sp.parameter_id,
            'value', sp.value,
            'parameter', json_build_object(
              'id', pcp.id,
              'name', pcp.name,
              'type', pcp.type,
              'unit', pcp.unit,
              'required', pcp.required
            )
          ) ORDER BY sp.id
        ) FILTER (WHERE sp.id IS NOT NULL),
        '[]'
      ) AS parameters
     FROM parts p
     JOIN part_categories pc ON pc.id = p.category_id
     LEFT JOIN stock_parameters sp ON sp.part_id = p.id
     LEFT JOIN part_category_parameters pcp ON pcp.id = sp.parameter_id
     GROUP BY p.id, pc.id
     ORDER BY p.created_at DESC`
  );
  res.json(result.rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const data = schema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const partResult = await client.query(
      `INSERT INTO parts (category_id, name, price_per_piece, location, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, category_id AS "categoryId", name, price_per_piece AS "pricePerPiece", location, description, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [data.categoryId, data.name, data.pricePerPiece, data.location || null, data.description || null]
    );
    const part = partResult.rows[0];
    const parameters = [];
    for (const p of data.parameters) {
      const paramResult = await client.query(
        `INSERT INTO stock_parameters (part_id, parameter_id, value)
         VALUES ($1, $2, $3)
         RETURNING id, part_id AS "partId", parameter_id AS "parameterId", value, created_at AS "createdAt"`,
        [part.id, p.parameterId, p.value]
      );
      parameters.push(paramResult.rows[0]);
    }
    await client.query('COMMIT');
    res.json({ ...part, parameters });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
