import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  partCategoryPayloadSchema,
  partCategoryParameterColumnPatchSchema,
} from '../schemas/partCategories.schema.js';
import { regenerateCategoryPartNames } from '../services/partName.js';
import {
  logAudit,
  resolveActor,
  diffFields,
  valuesEqual,
  diffKeyedEvents,
  type AuditEvent,
  type KeyedValue,
} from '../services/audit.js';

const router = Router();

// A category parameter definition, as needed for auditing.
interface CategoryParam {
  id?: number;
  name: string;
  type: string;
  unit: string | null;
  required: boolean;
  showAsColumn: boolean;
  options: string[];
}

// Compact human-readable descriptor of a parameter definition. Excludes
// sort_order so reordering parameters never registers as a change. Includes
// `required` so toggling it is logged, and the name so a rename is visible.
function paramDescriptor(p: CategoryParam): string {
  const bits: string[] = [`${p.name}: ${p.type}`];
  if (p.unit) bits.push(p.unit);
  if (p.required) bits.push('required');
  if (p.showAsColumn) bits.push('column');
  if (p.options.length) bits.push(`[${p.options.join(', ')}]`);
  return bits.join(' · ');
}

// A parameter definition as a keyed value: matched by id (stable across
// renames), labelled by name, compared via its descriptor.
function toKeyedValue(p: CategoryParam): KeyedValue {
  return { key: p.id, label: p.name, value: paramDescriptor(p) };
}

router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT
      pc.id,
      pc.name,
      pc.description,
      pc.image,
      pc.part_name_mode AS "partNameMode",
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
  const userId = req.user?.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryResult = await client.query(
      `INSERT INTO part_categories (name, description, image, part_name_mode)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, image,
         part_name_mode AS "partNameMode", created_at AS "createdAt"`,
      [data.name, data.description, data.image || null, data.partNameMode],
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

    const actor = await resolveActor(client, userId);
    await logAudit(client, 'part_category', category.id, 'created', {
      snapshot: { name: data.name, description: data.description },
    }, actor);

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
  const userId = req.user?.id;
  const client = await pool.connect();

  // Parameter change events for the audit log; empty when `parameters` was omitted.
  let paramEvents: AuditEvent[] = [];

  try {
    await client.query('BEGIN');

    // Snapshot the pre-update row in the same statement (see parts.ts) so we get
    // old + new values without an extra query.
    const categoryResult = await client.query(
      `
      UPDATE part_categories
      SET name = $1, image = $2, description = $3, part_name_mode = $4
      FROM (SELECT * FROM part_categories WHERE id = $5) old
      WHERE part_categories.id = old.id
      RETURNING part_categories.id, part_categories.name, part_categories.image,
        part_categories.description,
        part_categories.part_name_mode AS "partNameMode",
        part_categories.created_at AS "createdAt",
        old.name           AS "oldName",
        old.description    AS "oldDescription",
        old.image          AS "oldImage",
        old.part_name_mode AS "oldPartNameMode"
      `,
      [
        data.name,
        data.image || null,
        data.description,
        data.partNameMode,
        categoryId,
      ],
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

      // Pull full fields (not just id) so the audit delta compares definitions.
      const existingResult = await client.query<{
        id: number;
        name: string;
        type: string;
        unit: string | null;
        required: boolean;
        showAsColumn: boolean;
        options: string[];
      }>(
        `
        SELECT id, name, type, unit, required,
          show_as_column AS "showAsColumn",
          COALESCE(options, ARRAY[]::text[]) AS options
        FROM part_category_parameters
        WHERE category_id = $1
        `,
        [categoryId],
      );

      // Diff before mutating: existing rows vs the incoming set, matched by id.
      const beforeParams: KeyedValue[] = existingResult.rows.map((r) =>
        toKeyedValue({
          id: r.id,
          name: r.name,
          type: r.type,
          unit: r.unit,
          required: r.required,
          showAsColumn: r.showAsColumn,
          options: r.options,
        }),
      );
      const afterParams: KeyedValue[] = incomingParameters.map((p) =>
        toKeyedValue({
          id: p.id,
          name: p.name,
          type: p.type,
          unit: p.unit ?? null,
          required: p.required,
          showAsColumn: p.showAsColumn ?? false,
          options: p.type === 'dropdown' ? p.options : [],
        }),
      );
      paramEvents = diffKeyedEvents(beforeParams, afterParams, 'parameter');

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

    // The category name, its mode and its column parameters all feed generated
    // part names, so any of these edits can leave existing parts stale.
    const regeneratedParts = await regenerateCategoryPartNames(client, categoryId);

    // ── Audit: diff scalar fields + parameters, log only if something changed ──
    const row = categoryResult.rows[0];
    const fields = diffFields(
      {
        name: row.oldName,
        description: row.oldDescription,
        part_name_mode: row.oldPartNameMode,
      },
      {
        name: row.name,
        description: row.description,
        part_name_mode: row.partNameMode,
      },
      ['name', 'description', 'part_name_mode'],
    ) as Record<string, { from: unknown; to: unknown }>;

    if (!valuesEqual(row.oldImage, row.image)) {
      fields.image = {
        from: row.oldImage ? '(image)' : null,
        to: row.image ? '(image)' : null,
      };
    }

    const changes: Record<string, unknown> = {};
    if (Object.keys(fields).length > 0) changes.fields = fields;
    if (paramEvents.length > 0) changes.events = paramEvents;
    // Logged once on the category — a rename can rewrite hundreds of part
    // names, and one audit row each would drown the log.
    if (regeneratedParts > 0) changes.regeneratedPartNames = regeneratedParts;

    if (Object.keys(changes).length > 0) {
      const actor = await resolveActor(client, userId);
      await logAudit(client, 'part_category', categoryId, 'updated', changes, actor);
    }

    await client.query('COMMIT');

    // Drop the old* snapshot columns — audit-only.
    const {
      oldName: _on,
      oldDescription: _od,
      oldImage: _oi,
      oldPartNameMode: _om,
      ...categoryOut
    } = row;

    res.json({
      ...categoryOut,
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

    // Transactional because the column flag also decides which parameters feed
    // generated part names: the toggle and the rename of every affected part
    // have to land together.
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
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
        await client.query('ROLLBACK');
        return res.status(404).json({ code: ErrorCodes.PARAMETER_NOT_FOUND });
      }

      await regenerateCategoryPartNames(client, categoryId);
      await client.query('COMMIT');

      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(error);
      res.status(500).json({ code: ErrorCodes.PARAMETER_UPDATE_FAILED });
    } finally {
      client.release();
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

    const deleteResult = await client.query<{ id: number; name: string }>(
      `
      DELETE FROM part_categories
      WHERE id = $1
      RETURNING id, name
      `,
      [categoryId],
    );

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        code: ErrorCodes.CATEGORY_NOT_FOUND,
      });
    }

    const actor = await resolveActor(client, req.user?.id);
    await logAudit(client, 'part_category', categoryId, 'deleted', {
      snapshot: { name: deleteResult.rows[0].name },
    }, actor);

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
