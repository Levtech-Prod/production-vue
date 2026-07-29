import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import { stockEntryPayloadSchema } from '../schemas/stockEntries.schema.js';
import { convertToEur } from '../services/exchangeRates.js';

const router = Router();

// Shared SELECT shape used by both GET and the POST response
const SELECT_ENTRY = `
  SELECT
    se.id,
    se.part_id            AS "partId",
    se.type,
    se.quantity,
    se.quantity_consumed  AS "quantityConsumed",
    se.price_per_piece    AS "pricePerPiece",
    se.entered_amount     AS "enteredAmount",
    se.entered_currency   AS "enteredCurrency",
    se.rate_used          AS "rateUsed",
    to_char(se.rate_date, 'YYYY-MM-DD') AS "rateDate",
    se.note,
    se.entered_at         AS "enteredAt",
    CASE
      WHEN c.id IS NOT NULL
      THEN json_build_object('id', c.id, 'name', c.name)
      ELSE NULL
    END                   AS company,
    CASE
      WHEN u.id IS NOT NULL
      THEN json_build_object('id', u.id, 'username', u.username)
      ELSE NULL
    END                   AS "enteredBy"
  FROM stock_entries se
  LEFT JOIN companies c ON c.id = se.company_id
  LEFT JOIN users   u ON u.id = se.entered_by
`;

async function fetchEntryById(id: number) {
  const result = await query(`${SELECT_ENTRY} WHERE se.id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function fetchEntriesByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const result = await query(`${SELECT_ENTRY} WHERE se.id = ANY($1)`, [ids]);
  return result.rows;
}

// GET /api/stock-entries?partId=:id — all movements for a part, newest first
router.get('/', requireAuth, async (req, res) => {
  const partId = Number(req.query.partId);
  if (!partId || Number.isNaN(partId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PART_ID });
  }

  const result = await query(
    `${SELECT_ENTRY}
     WHERE se.part_id = $1
     ORDER BY se.entered_at DESC`,
    [partId],
  );

  res.json(result.rows);
});

// POST /api/stock-entries — log a received or removed stock movement
router.post('/', requireAuth, async (req, res) => {
  const data = stockEntryPayloadSchema.parse(req.body);

  // @ts-ignore — user is attached by requireAuth middleware
  const userId: number | undefined = req.user?.id;

  if (data.type === 'received') {
    // Convert the entered price to canonical EUR (BNR rate for today, frozen).
    const price = await convertToEur(
      data.pricePerPiece.amount,
      data.pricePerPiece.currency,
    );
    try {
      const result = await query(
        `INSERT INTO stock_entries
           (type, part_id, company_id, quantity, price_per_piece,
            entered_amount, entered_currency, rate_used, rate_date, entered_by)
         VALUES ('received', $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          data.partId,
          data.companyId,
          data.quantity,
          price.priceEur,
          data.pricePerPiece.amount,
          data.pricePerPiece.currency,
          price.rateUsed,
          price.rateDate,
          userId ?? null,
        ],
      );

      const entry = await fetchEntryById(result.rows[0].id);
      // A received entry doesn't alter existing rows, so nothing else changed.
      return res.status(201).json({ entry, affectedReceived: [] });
    } catch (err: any) {
      if (err?.code === '23503') {
        // FK violation: part or company doesn't exist
        return res.status(404).json({ code: ErrorCodes.STOCK_ENTRY_SAVE_FAILED });
      }
      throw err;
    }
  }

  // type === 'removed' — FIFO deduction inside a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock available received entries oldest-first to prevent races
    const entriesResult = await client.query<{ id: number; available: string }>(
      `SELECT id, (quantity - quantity_consumed) AS available
       FROM stock_entries
       WHERE part_id = $1
         AND type = 'received'
         AND quantity > quantity_consumed
       ORDER BY entered_at ASC
       FOR UPDATE`,
      [data.partId],
    );

    const totalAvailable = entriesResult.rows.reduce(
      (sum, e) => sum + Number(e.available),
      0,
    );

    if (totalAvailable < data.quantity) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: ErrorCodes.INSUFFICIENT_STOCK });
    }

    // Deduct from oldest batches first, tracking which received rows changed
    const affectedIds: number[] = [];
    let remaining = data.quantity;
    for (const entry of entriesResult.rows) {
      if (remaining <= 0) break;
      const deduct = Math.min(remaining, Number(entry.available));
      await client.query(
        `UPDATE stock_entries
         SET quantity_consumed = quantity_consumed + $1
         WHERE id = $2`,
        [deduct, entry.id],
      );
      affectedIds.push(entry.id);
      remaining -= deduct;
    }

    // Record the removal as a new stock_entries row
    const removalResult = await client.query(
      `INSERT INTO stock_entries (type, part_id, quantity, note, entered_by)
       VALUES ('removed', $1, $2, $3, $4)
       RETURNING id`,
      [data.partId, data.quantity, data.note, userId ?? null],
    );

    await client.query('COMMIT');

    // Return the removal plus the drawn-down received rows so the client can
    // patch its cache (fresh quantityConsumed) without a follow-up refetch.
    const [entry, affectedReceived] = await Promise.all([
      fetchEntryById(removalResult.rows[0].id),
      fetchEntriesByIds(affectedIds),
    ]);
    return res.status(201).json({ entry, affectedReceived });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
