import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import { partPayloadSchema } from '../schemas/parts.schema.js';
import { convertToEur } from '../services/exchangeRates.js';
import { resolvePartNameForCategory } from '../services/partName.js';
import {
  logAudit,
  resolveActor,
  diffFields,
  diffKeyedEvents,
  valuesEqual,
  type KeyedValue,
} from '../services/audit.js';

const router = Router();

/** Submitted parameter values keyed by parameter id, as part naming expects. */
function valuesByParameterId(
  parameters: { parameterId: number; value: string }[],
): Record<number, string> {
  return Object.fromEntries(parameters.map((p) => [p.parameterId, p.value]));
}

/** Order-independent equality for secondary codes — re-typing the same set
 *  in a different order is not a change worth logging. */
function sameStringSet(a: string[] | null, b: string[] | null): boolean {
  const as = [...(a ?? [])].sort();
  const bs = [...(b ?? [])].sort();
  return as.length === bs.length && as.every((v, i) => v === bs[i]);
}

// Columns exposing the stored EUR price plus how it was entered (amount +
// currency the user typed, and the BNR rate/date applied for RON entries).
const PART_PRICE_COLUMNS = `
  p.price_per_piece        AS "pricePerPiece",
  p.price_entered_amount   AS "priceEnteredAmount",
  p.price_entered_currency AS "priceEnteredCurrency",
  p.price_rate_used        AS "priceRateUsed",
  to_char(p.price_rate_date, 'YYYY-MM-DD') AS "priceRateDate"`;

router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT
      p.id,
      p.category_id AS "categoryId",
      p.name,
      p.name_prefix AS "namePrefix",
      p.code,
      p.secondary_code AS "secondaryCodes",
      ${PART_PRICE_COLUMNS},
      p.location,
      p.description,
      p.image,
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
      ) AS parameters,
      -- Correlated subqueries keep this independent of the parameters aggregation.
      -- All quantities use (quantity - quantity_consumed) to reflect available stock
      -- after FIFO removals have been applied.
      COALESCE(
        (SELECT SUM(quantity - quantity_consumed) FROM stock_entries WHERE part_id = p.id AND type = 'received'),
        0
      ) AS "totalQuantity",
      COALESCE(
        (
          SELECT CASE
            WHEN SUM(quantity - quantity_consumed) > 0
            THEN SUM(price_per_piece * (quantity - quantity_consumed))
                 / SUM(quantity - quantity_consumed)
            ELSE NULL
          END
          FROM stock_entries WHERE part_id = p.id AND type = 'received'
        ),
        p.price_per_piece
      ) AS "avgPricePerPiece"
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
  const data = partPayloadSchema.parse(req.body);
  const userId = req.user?.id;
  // Convert the entered price to canonical EUR before opening the transaction.
  const price = await convertToEur(
    data.pricePerPiece.amount,
    data.pricePerPiece.currency,
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const name = await resolvePartNameForCategory(
      client,
      data.categoryId,
      data.name,
      valuesByParameterId(data.parameters),
    );

    if (name === null) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.CATEGORY_NOT_FOUND });
    }

    // Only reachable in 'custom' mode — a generated name always carries at
    // least the category name.
    if (!name) {
      await client.query('ROLLBACK');
      return res.status(422).json({ code: ErrorCodes.PART_NAME_REQUIRED });
    }

    const partResult = await client.query(
      `INSERT INTO parts
         (category_id, name, name_prefix, code, secondary_code, price_per_piece, price_entered_amount,
          price_entered_currency, price_rate_used, price_rate_date,
          location, description, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, category_id AS "categoryId", name, name_prefix AS "namePrefix", code,
         secondary_code AS "secondaryCodes",
         ${PART_PRICE_COLUMNS.replace(/\bp\./g, '')},
         location, description, image, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        data.categoryId,
        name,
        data.name,
        data.code,
        data.secondaryCodes,
        price.priceEur,
        data.pricePerPiece.amount,
        data.pricePerPiece.currency,
        price.rateUsed,
        price.rateDate,
        data.location || null,
        data.description || null,
        data.image || null,
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

    // Audit: record creation with an identifying snapshot.
    const categoryResult = await client.query<{ name: string }>(
      `SELECT name FROM part_categories WHERE id = $1`,
      [data.categoryId],
    );
    const actor = await resolveActor(client, userId);
    await logAudit(client, 'part', part.id, 'created', {
      snapshot: {
        name,
        code: data.code,
        category: categoryResult.rows[0]?.name ?? null,
        price: {
          amount: data.pricePerPiece.amount,
          currency: data.pricePerPiece.currency,
        },
        location: data.location || null,
      },
    }, actor);

    await client.query('COMMIT');
    res.json({ ...part, parameters });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res.status(409).json({
        code: ErrorCodes.PART_CODE_ALREADY_EXISTS,
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const partId = Number(req.params.id);

  if (!partId || Number.isNaN(partId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PART_ID });
  }

  // Validate before opening a connection so ZodErrors reach the global
  // error handler and are returned as structured validation issues.
  const data = partPayloadSchema.parse(req.body);
  const userId = req.user?.id;
  const price = await convertToEur(
    data.pricePerPiece.amount,
    data.pricePerPiece.currency,
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const name = await resolvePartNameForCategory(
      client,
      data.categoryId,
      data.name,
      valuesByParameterId(data.parameters),
    );

    if (name === null) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.CATEGORY_NOT_FOUND });
    }

    if (!name) {
      await client.query('ROLLBACK');
      return res.status(422).json({ code: ErrorCodes.PART_NAME_REQUIRED });
    }

    // Snapshot the pre-update row inside the same UPDATE (FROM subquery is
    // evaluated first), so we get old + new values in one statement — no extra
    // round trip and no read-then-write race. `old.*` fields feed the audit diff.
    const partResult = await client.query(
      `
      UPDATE parts
      SET category_id = $1, name = $2, name_prefix = $3, code = $4, secondary_code = $5,
          price_per_piece = $6,
          price_entered_amount = $7, price_entered_currency = $8,
          price_rate_used = $9, price_rate_date = $10,
          location = $11, description = $12, image = $13, updated_at = NOW()
      FROM (SELECT * FROM parts WHERE id = $14) old
      WHERE parts.id = old.id
      RETURNING parts.id, parts.category_id AS "categoryId", parts.name,
        parts.name_prefix AS "namePrefix", parts.code,
        parts.secondary_code AS "secondaryCodes",
        ${PART_PRICE_COLUMNS.replace(/\bp\./g, 'parts.')},
        parts.location, parts.description, parts.image,
        parts.created_at AS "createdAt", parts.updated_at AS "updatedAt",
        old.category_id            AS "oldCategoryId",
        old.name                   AS "oldName",
        old.code                   AS "oldCode",
        old.secondary_code         AS "oldSecondaryCodes",
        old.price_entered_amount   AS "oldPriceEnteredAmount",
        old.price_entered_currency AS "oldPriceEnteredCurrency",
        old.location               AS "oldLocation",
        old.description            AS "oldDescription",
        old.image                  AS "oldImage"
      `,
      [
        data.categoryId,
        name,
        data.name,
        data.code,
        data.secondaryCodes,
        price.priceEur,
        data.pricePerPiece.amount,
        data.pricePerPiece.currency,
        price.rateUsed,
        price.rateDate,
        data.location || null,
        data.description || null,
        data.image || null,
        partId,
      ],
    );

    if (partResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PART_NOT_FOUND });
    }

    // Also pull value + parameter name so the audit delta reuses this read
    // instead of issuing a second query.
    const existingResult = await client.query<{
      parameter_id: number;
      value: string;
      name: string;
    }>(
      `SELECT sp.parameter_id, sp.value, pcp.name
       FROM stock_parameters sp
       JOIN part_category_parameters pcp ON pcp.id = sp.parameter_id
       WHERE sp.part_id = $1`,
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

    // ── Audit: diff old vs new and log only if something actually changed ──
    const row = partResult.rows[0];

    // Scalar fields (price and image handled separately below). Category is
    // diffed on id but stored as a human label.
    const fields = diffFields(
      { name: row.oldName, code: row.oldCode, location: row.oldLocation, description: row.oldDescription },
      { name: row.name, code: row.code, location: row.location, description: row.description },
      ['name', 'code', 'location', 'description'],
    ) as Record<string, { from: unknown; to: unknown }>;

    if (!valuesEqual(row.oldCategoryId, row.categoryId)) {
      const cats = await client.query<{ id: number; name: string }>(
        `SELECT id, name FROM part_categories WHERE id = ANY($1::int[])`,
        [[row.oldCategoryId, row.categoryId]],
      );
      const nameById = new Map(cats.rows.map((c) => [c.id, c.name]));
      fields.category = {
        from: nameById.get(row.oldCategoryId) ?? row.oldCategoryId,
        to: nameById.get(row.categoryId) ?? row.categoryId,
      };
    }

    // Price: compare only the entered amount + currency. The stored EUR price
    // and BNR rate columns are recomputed every save and would report phantom
    // changes whenever the exchange rate moves.
    if (
      !valuesEqual(row.oldPriceEnteredAmount, row.priceEnteredAmount) ||
      !valuesEqual(row.oldPriceEnteredCurrency, row.priceEnteredCurrency)
    ) {
      fields.price = {
        from: { amount: Number(row.oldPriceEnteredAmount), currency: row.oldPriceEnteredCurrency },
        to: { amount: Number(row.priceEnteredAmount), currency: row.priceEnteredCurrency },
      };
    }

    // Image: track that it changed without dumping the (large) value into the log.
    if (!valuesEqual(row.oldImage, row.image)) {
      fields.image = {
        from: row.oldImage ? '(image)' : null,
        to: row.image ? '(image)' : null,
      };
    }

    // Secondary codes: an unordered list, so compare sorted — reordering the
    // same set of codes is not a change.
    if (!sameStringSet(row.oldSecondaryCodes, row.secondaryCodes)) {
      fields.secondaryCode = {
        from: row.oldSecondaryCodes ?? [],
        to: row.secondaryCodes ?? [],
      };
    }

    // Parameters: build events from data already read above (no extra query).
    const paramNameRes = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM part_category_parameters WHERE id = ANY($1::int[])`,
      [incomingParameterIds.length ? incomingParameterIds : [0]],
    );
    const paramNameById = new Map(paramNameRes.rows.map((r) => [r.id, r.name]));
    const beforeParams: KeyedValue[] = existingResult.rows.map((r) => ({
      key: r.parameter_id,
      label: r.name,
      value: r.value,
    }));
    const afterParams: KeyedValue[] = data.parameters.map((p) => ({
      key: p.parameterId,
      label: paramNameById.get(p.parameterId) ?? String(p.parameterId),
      value: p.value,
    }));
    const paramEvents = diffKeyedEvents(beforeParams, afterParams, 'parameter');

    const changes: Record<string, unknown> = {};
    if (Object.keys(fields).length > 0) changes.fields = fields;
    if (paramEvents.length > 0) changes.events = paramEvents;

    if (Object.keys(changes).length > 0) {
      const actor = await resolveActor(client, userId);
      await logAudit(client, 'part', partId, 'updated', changes, actor);
    }

    await client.query('COMMIT');

    // Drop the old* snapshot columns from the response — they're audit-only.
    const {
      oldCategoryId: _oc,
      oldName: _on,
      oldCode: _ocode,
      oldSecondaryCodes: _osc,
      oldPriceEnteredAmount: _opa,
      oldPriceEnteredCurrency: _opc,
      oldLocation: _ol,
      oldDescription: _od,
      oldImage: _oi,
      ...partOut
    } = row;

    res.json({
      ...partOut,
      category: categoryResult.rows[0]?.category,
      parameters: updatedParametersResult.rows,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res.status(409).json({
        code: ErrorCodes.PART_CODE_ALREADY_EXISTS,
      });
    }
    console.error(err);
    res.status(500).json({ code: ErrorCodes.PART_UPDATE_FAILED });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const partId = Number(req.params.id);

    if (!partId || Number.isNaN(partId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PART_ID });
    }

    await client.query('BEGIN');

    // Capture identifying fields for the audit snapshot before the row is gone.
    const deleteResult = await client.query<{ id: number; name: string; code: string }>(
      `DELETE FROM parts WHERE id = $1 RETURNING id, name, code`,
      [partId],
    );

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PART_NOT_FOUND });
    }

    // Audit rows have no FK to parts, so they survive this hard delete.
    const deleted = deleteResult.rows[0];
    const actor = await resolveActor(client, req.user?.id);
    await logAudit(client, 'part', partId, 'deleted', {
      snapshot: { name: deleted.name, code: deleted.code },
    }, actor);

    await client.query('COMMIT');

    res.json({ message: 'Alkatrész sikeresen törölve.', id: partId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ code: ErrorCodes.PART_DELETE_FAILED });
  } finally {
    client.release();
  }
});

export default router;
