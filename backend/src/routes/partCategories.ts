import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  parameters: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['text', 'number', 'boolean', 'dropdown']).default('text'),
        unit: z.string().optional().nullable(),
        required: z.boolean().default(false),
        options: z.array(z.string().min(1)).optional().default([]), // Only for dropdown type
      }),
    )
    .optional()
    .default([]),
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
            'options', COALESCE(pcp.options, ARRAY[]::text[]),
            'createdAt', pcp.created_at
          ) ORDER BY pcp.id
        ) FILTER (WHERE pcp.id IS NOT NULL),
        '[]'
      ) AS parameters
     FROM part_categories pc
     LEFT JOIN part_category_parameters pcp ON pcp.category_id = pc.id
     GROUP BY pc.id
     ORDER BY pc.name ASC`,
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
      [data.name, data.description || null, data.image || null],
    );
    const category = categoryResult.rows[0];
    const parameters = [];
    for (const p of data.parameters) {
      const pResult = await client.query(
        `INSERT INTO part_category_parameters (category_id, name, type, unit, required, options)
         VALUES ($1, $2, $3, $4, $5, $6::text[])
         RETURNING id, category_id AS "categoryId", name, type, unit, required, options, created_at AS "createdAt"`,
        [
          category.id,
          p.name,
          p.type,
          p.unit || null,
          p.required || false,
          p.type === 'dropdown'
            ? (p.options || []).filter((option: string) => option.trim() !== '')
            : [],
        ],
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

router.put('/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    const categoryId = Number(req.params.id);
    const { name, image, parameters = [] } = req.body;

    if (!categoryId || Number.isNaN(categoryId)) {
      return res.status(400).json({ message: 'Invalid category id' });
    }

    if (!name?.trim()) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    await client.query('BEGIN');

    const categoryResult = await client.query(
      `
      UPDATE part_categories
      SET name = $1, image = $2
      WHERE id = $3
      RETURNING id, name, image, created_at
      `,
      [name.trim(), image || null, categoryId],
    );

    if (categoryResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Part category not found' });
    }

    const existingResult = await client.query(
      `
      SELECT id
      FROM part_category_parameters
      WHERE category_id = $1
      `,
      [categoryId],
    );

    const existingIds = existingResult.rows.map((row) => row.id);

    const incomingExistingIds = parameters
      .filter((parameter: any) => parameter.id)
      .map((parameter: any) => Number(parameter.id));

    const idsToDelete = existingIds.filter(
      (id) => !incomingExistingIds.includes(id),
    );

    if (idsToDelete.length > 0) {
      const usedResult = await client.query(
        `
        SELECT DISTINCT parameter_id
        FROM stock_parameters
        WHERE parameter_id = ANY($1::int[])
        `,
        [idsToDelete],
      );

      if (usedResult.rowCount && usedResult.rowCount > 0) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          message:
            'One or more removed parameters are already used by parts and cannot be deleted.',
          usedParameterIds: usedResult.rows.map((row) => row.parameter_id),
        });
      }

      await client.query(
        `
        DELETE FROM part_category_parameters
        WHERE id = ANY($1::int[])
        `,
        [idsToDelete],
      );
    }

    for (const parameter of parameters) {
      if (!parameter.name?.trim()) continue;

      if (parameter.id) {
        await client.query(
          `
          UPDATE part_category_parameters
          SET name = $1, type = $2, unit = $3, required = $4, options = $5::text[]
          WHERE id = $6 AND category_id = $7
          `,
          [
            parameter.name.trim(),
            parameter.type,
            parameter.unit || null,
            parameter.required || false,
            parameter.type === 'dropdown'
              ? (parameter.options || []).filter(
                  (option: string) => option.trim() !== '',
                )
              : [],
            parameter.id,
            categoryId,
          ],
        );
      } else {
        await client.query(
          `
          INSERT INTO part_category_parameters
            (category_id, name, type, unit, required, options)
          VALUES
            ($1, $2, $3, $4, $5, $6::text[])
          `,
          [
            categoryId,
            parameter.name.trim(),
            parameter.type,
            parameter.unit || null,
            parameter.required || false,
            parameter.type === 'dropdown'
              ? (parameter.options || []).filter(
                  (option: string) => option.trim() !== '',
                )
              : [],
          ],
        );
      }
    }

    const updatedParametersResult = await client.query(
      `
      SELECT id, name, type, unit, required, COALESCE(options, ARRAY[]::text[]) AS options
      FROM part_category_parameters
      WHERE category_id = $1
      ORDER BY id ASC
      `,
      [categoryId],
    );

    await client.query('COMMIT');

    res.json({
      ...categoryResult.rows[0],
      parameters: updatedParametersResult.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);

    res.status(500).json({
      message: 'Failed to update part category',
    });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    const categoryId = Number(req.params.id);

    if (!categoryId || Number.isNaN(categoryId)) {
      return res.status(400).json({
        message: 'Érvénytelen kategória azonosító.',
      });
    }

    await client.query('BEGIN');

    const linkedPartsResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM parts
      WHERE category_id = $1
      `,
      [categoryId],
    );

    if (linkedPartsResult.rows[0].count > 0) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        message:
          'A kategória nem törölhető, mert már tartozik hozzá létrehozott alkatrész.',
      });
    }

    await client.query(
      `
      DELETE FROM part_category_parameters
      WHERE category_id = $1
      `,
      [categoryId],
    );

    const deleteResult = await client.query(
      `
      DELETE FROM part_categories
      WHERE id = $1
      RETURNING id
      `,
      [categoryId],
    );

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        message: 'A kategória nem található.',
      });
    }

    await client.query('COMMIT');

    res.json({
      message: 'Kategória sikeresen törölve.',
      id: categoryId,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);

    res.status(500).json({
      message: 'Hiba történt a kategória törlése közben.',
    });
  } finally {
    client.release();
  }
});

export default router;
