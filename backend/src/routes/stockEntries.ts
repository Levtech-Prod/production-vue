import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import { stockEntryPayloadSchema } from '../schemas/stockEntries.schema.js';

const router = Router();

// GET /api/stock-entries?partId=:id — all entries for a given part, newest first
router.get('/', requireAuth, async (req, res) => {
  const partId = Number(req.query.partId);
  if (!partId || Number.isNaN(partId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PART_ID });
  }

  const result = await query(
    `SELECT
       se.id,
       se.part_id              AS "partId",
       se.quantity,
       se.price_per_piece      AS "pricePerPiece",
       se.entered_at           AS "enteredAt",
       json_build_object(
         'id',   c.id,
         'name', c.name
       )                       AS company,
       CASE
         WHEN u.id IS NOT NULL
         THEN json_build_object('id', u.id, 'username', u.username)
         ELSE NULL
       END                     AS "enteredBy"
     FROM stock_entries se
     JOIN companies c ON c.id = se.company_id
     LEFT JOIN users u ON u.id = se.entered_by
     WHERE se.part_id = $1
     ORDER BY se.entered_at DESC`,
    [partId],
  );

  res.json(result.rows);
});

// POST /api/stock-entries — log a new stock receipt
router.post('/', requireAuth, async (req, res) => {
  const data = stockEntryPayloadSchema.parse(req.body);

  // @ts-ignore — user is attached by requireAuth middleware
  const userId: number | undefined = req.user?.id;

  try {
    const result = await query(
      `INSERT INTO stock_entries (part_id, company_id, quantity, price_per_piece, entered_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id,
         part_id         AS "partId",
         quantity,
         price_per_piece AS "pricePerPiece",
         entered_at      AS "enteredAt"`,
      [data.partId, data.companyId, data.quantity, data.pricePerPiece, userId ?? null],
    );

    const entry = result.rows[0];

    // Fetch joined company + user so the response matches the GET shape
    const joined = await query(
      `SELECT
         se.id,
         se.part_id              AS "partId",
         se.quantity,
         se.price_per_piece      AS "pricePerPiece",
         se.entered_at           AS "enteredAt",
         json_build_object('id', c.id, 'name', c.name) AS company,
         CASE
           WHEN u.id IS NOT NULL
           THEN json_build_object('id', u.id, 'username', u.username)
           ELSE NULL
         END AS "enteredBy"
       FROM stock_entries se
       JOIN companies c ON c.id = se.company_id
       LEFT JOIN users u ON u.id = se.entered_by
       WHERE se.id = $1`,
      [entry.id],
    );

    res.status(201).json(joined.rows[0]);
  } catch (err: any) {
    if (err?.code === '23503') {
      // FK violation: part or company doesn't exist
      return res.status(404).json({ code: ErrorCodes.STOCK_ENTRY_SAVE_FAILED });
    }
    throw err;
  }
});

export default router;
