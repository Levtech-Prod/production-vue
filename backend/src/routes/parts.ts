import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
const schema = z.object({
  categoryId: z.number(),
  name: z.string().min(2),
  code: z.string().min(1),
  pricePerPiece: z.number().nonnegative(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  parameters: z
    .array(z.object({ parameterId: z.number(), value: z.string() }))
    .default([]),
});

router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT
      p.id,
      p.category_id AS "categoryId",
      p.name,
      p.code,
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
     ORDER BY p.created_at DESC`,
  );
  res.json(result.rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const data = schema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const partResult = await client.query(
      `INSERT INTO parts (category_id, name, code, price_per_piece, location, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, category_id AS "categoryId", name, code, price_per_piece AS "pricePerPiece", location, description, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        data.categoryId,
        data.name,
        data.code,
        data.pricePerPiece,
        data.location || null,
        data.description || null,
      ],
    );
    const part = partResult.rows[0];
    const parameters = [];
    for (const p of data.parameters) {
      const paramResult = await client.query(
        `INSERT INTO stock_parameters (part_id, parameter_id, value)
         VALUES ($1, $2, $3)
         RETURNING id, part_id AS "partId", parameter_id AS "parameterId", value, created_at AS "createdAt"`,
        [part.id, p.parameterId, p.value],
      );
      parameters.push(paramResult.rows[0]);
    }
    await client.query('COMMIT');
    res.json({ ...part, parameters });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res.status(409).json({
        message: 'A megadott alkatrész kód már létezik.',
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const partId = Number(req.params.id);

    if (!partId || Number.isNaN(partId)) {
      return res.status(400).json({ message: 'Invalid part id' });
    }

    const data = schema.parse(req.body);

    await client.query('BEGIN');

    const partResult = await client.query(
      `
      UPDATE parts
      SET category_id = $1, name = $2, code = $3, price_per_piece = $4,
          location = $5, description = $6, updated_at = NOW()
      WHERE id = $7
      RETURNING id, category_id AS "categoryId", name, code,
        price_per_piece AS "pricePerPiece", location, description,
        created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      [
        data.categoryId,
        data.name,
        data.code,
        data.pricePerPiece,
        data.location || null,
        data.description || null,
        partId,
      ],
    );

    if (partResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Part not found' });
    }

    const existingResult = await client.query(
      `SELECT parameter_id FROM stock_parameters WHERE part_id = $1`,
      [partId],
    );

    const existingParameterIds = existingResult.rows.map(
      (row) => row.parameter_id,
    );

    const incomingParameterIds = data.parameters.map((p) => p.parameterId);

    const idsToDelete = existingParameterIds.filter(
      (id) => !incomingParameterIds.includes(id),
    );

    if (idsToDelete.length > 0) {
      await client.query(
        `DELETE FROM stock_parameters
         WHERE part_id = $1 AND parameter_id = ANY($2::int[])`,
        [partId, idsToDelete],
      );
    }

    for (const p of data.parameters) {
      await client.query(
        `
        INSERT INTO stock_parameters (part_id, parameter_id, value)
        VALUES ($1, $2, $3)
        ON CONFLICT (part_id, parameter_id)
        DO UPDATE SET value = EXCLUDED.value
        `,
        [partId, p.parameterId, p.value],
      );
    }

    const updatedParametersResult = await client.query(
      `
      SELECT
        sp.id,
        sp.part_id AS "partId",
        sp.parameter_id AS "parameterId",
        sp.value,
        json_build_object(
          'id', pcp.id,
          'name', pcp.name,
          'type', pcp.type,
          'unit', pcp.unit,
          'required', pcp.required
        ) AS parameter
      FROM stock_parameters sp
      JOIN part_category_parameters pcp ON pcp.id = sp.parameter_id
      WHERE sp.part_id = $1
      ORDER BY sp.id ASC
      `,
      [partId],
    );

    const categoryResult = await client.query(
      `SELECT json_build_object('id', id, 'name', name, 'description', description, 'image', image) AS category
       FROM part_categories WHERE id = $1`,
      [data.categoryId],
    );

    await client.query('COMMIT');

    res.json({
      ...partResult.rows[0],
      category: categoryResult.rows[0]?.category,
      parameters: updatedParametersResult.rows,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res.status(409).json({
        message: 'A megadott alkatrész kód már létezik.',
      });
    }
    console.error(err);
    res.status(500).json({ message: 'Failed to update part' });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const partId = Number(req.params.id);

    if (!partId || Number.isNaN(partId)) {
      return res.status(400).json({ message: 'Érvénytelen alkatrész azonosító.' });
    }

    await client.query('BEGIN');

    const deleteResult = await client.query(
      `DELETE FROM parts WHERE id = $1 RETURNING id`,
      [partId],
    );

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Az alkatrész nem található.' });
    }

    await client.query('COMMIT');

    res.json({ message: 'Alkatrész sikeresen törölve.', id: partId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Hiba történt az alkatrész törlése közben.' });
  } finally {
    client.release();
  }
});

export default router;
