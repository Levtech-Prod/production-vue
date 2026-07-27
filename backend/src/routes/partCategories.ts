import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  partCategoryPayloadSchema,
  partCategoryParameterColumnPatchSchema,
} from '../schemas/partCategories.schema.js';

const router = Router();

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
            'showAsColumn', pcp.show_as_column,
            'options', COALESCE(pcp.options, ARRAY[]::text[]),
            'createdAt', pcp.created_at
          ) ORDER BY pcp.sort_order, pcp.id
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
  const data = partCategoryPayloadSchema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryResult = await client.query(
      `INSERT INTO part_categories (name, description, image)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, image, created_at AS "createdAt"`,
      [data.name, data.description, data.image || null],
    );
    const category = categoryResult.rows[0];
    const parameters = [];
    // The incoming array order is the source of truth for display order, so
    // persist each parameter's index as its sort_order.
    const incomingParameters = data.parameters ?? [];
    for (let sortOrder = 0; sortOrder < incomingParameters.length; sortOrder++) {
      const p = incomingParameters[sortOrder];
      const pResult = await client.query(
        `INSERT INTO part_category_parameters (category_id, name, type, unit, required, show_as_column, sort_order, options)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])
         RETURNING id, category_id AS "categoryId", name, type, unit, required, show_as_column AS "showAsColumn", options, created_at AS "createdAt"`,
        [
          category.id,
          p.name,
          p.type,
          p.unit || null,
          p.required || false,
          p.showAsColumn || false,
          sortOrder,
          p.type === 'dropdown' ? p.options : [],
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

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const categoryId = Number(req.params.id);

  if (!categoryId || Number.isNaN(categoryId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_CATEGORY_ID });
  }

  const data = partCategoryPayloadSchema.parse(req.body);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const categoryResult = await client.query(
      `
      UPDATE part_categories
      SET name = $1, image = $2, description = $3
      WHERE id = $4
      RETURNING id, name, image, description, created_at AS "createdAt"
      `,
      [data.name, data.image || null, data.description, categoryId],
    );

    if (categoryResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.CATEGORY_NOT_FOUND });
    }

    // Parameters are managed inline on the categories page, separately from
    // the category-details modal. When `parameters` is omitted, the caller is
    // only editing category-level fields, so we leave the existing rows alone.
    if (data.parameters !== undefined) {
      const incomingParameters = data.parameters;

      const existingResult = await client.query(
        `
        SELECT id
        FROM part_category_parameters
        WHERE category_id = $1
        `,
        [categoryId],
      );

      const existingIds = existingResult.rows.map((row) => row.id);

      const incomingExistingIds = incomingParameters
        .map((parameter) => parameter.id)
        .filter((id): id is number => id !== undefined);

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
            code: ErrorCodes.CATEGORY_PARAMETERS_IN_USE,
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

      // The incoming array order is the source of truth for display order, so
      // persist each parameter's index as its sort_order.
      for (let sortOrder = 0; sortOrder < incomingParameters.length; sortOrder++) {
        const parameter = incomingParameters[sortOrder];
        const options = parameter.type === 'dropdown' ? parameter.options : [];

        if (parameter.id) {
          await client.query(
            `
            UPDATE part_category_parameters
            SET name = $1, type = $2, unit = $3, required = $4, show_as_column = $5, sort_order = $6, options = $7::text[]
            WHERE id = $8 AND category_id = $9
            `,
            [
              parameter.name,
              parameter.type,
              parameter.unit || null,
              parameter.required,
              parameter.showAsColumn || false,
              sortOrder,
              options,
              parameter.id,
              categoryId,
            ],
          );
        } else {
          await client.query(
            `
            INSERT INTO part_category_parameters
              (category_id, name, type, unit, required, show_as_column, sort_order, options)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8::text[])
            `,
            [
              categoryId,
              parameter.name,
              parameter.type,
              parameter.unit || null,
              parameter.required,
              parameter.showAsColumn || false,
              sortOrder,
              options,
            ],
          );
        }
      }
    }

    const updatedParametersResult = await client.query(
      `
      SELECT id, name, type, unit, required, show_as_column AS "showAsColumn", COALESCE(options, ARRAY[]::text[]) AS options
      FROM part_category_parameters
      WHERE category_id = $1
      ORDER BY sort_order ASC, id ASC
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
      code: ErrorCodes.CATEGORY_UPDATE_FAILED,
    });
  } finally {
    client.release();
  }
});

// Toggle a single parameter's "show as column" flag. A focused endpoint so
// the Parts table can flip column visibility without re-sending (and
// re-validating) the whole category parameter set via PUT.
router.patch(
  '/:categoryId/parameters/:parameterId',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    const parameterId = Number(req.params.parameterId);

    if (!categoryId || Number.isNaN(categoryId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_CATEGORY_ID });
    }

    if (!parameterId || Number.isNaN(parameterId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PARAMETER_ID });
    }

    // Validated before touching the DB; a ZodError propagates to the global
    // handler and is returned as structured, localizable validation issues.
    const data = partCategoryParameterColumnPatchSchema.parse(req.body);

    try {
      const result = await query(
        `UPDATE part_category_parameters
         SET show_as_column = $1
         WHERE id = $2 AND category_id = $3
         RETURNING id, category_id AS "categoryId", name, type, unit, required,
           show_as_column AS "showAsColumn",
           COALESCE(options, ARRAY[]::text[]) AS options,
           created_at AS "createdAt"`,
        [data.showAsColumn, parameterId, categoryId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ code: ErrorCodes.PARAMETER_NOT_FOUND });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ code: ErrorCodes.PARAMETER_UPDATE_FAILED });
    }
  },
);

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const categoryId = Number(req.params.id);

    if (!categoryId || Number.isNaN(categoryId)) {
      return res.status(400).json({
        code: ErrorCodes.INVALID_CATEGORY_ID,
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
        code: ErrorCodes.CATEGORY_HAS_PARTS,
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
        code: ErrorCodes.CATEGORY_NOT_FOUND,
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
      code: ErrorCodes.CATEGORY_DELETE_FAILED,
    });
  } finally {
    client.release();
  }
});

export default router;
