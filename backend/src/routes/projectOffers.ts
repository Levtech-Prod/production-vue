// Project offers — the quote grid (projects-preparation-plan.md §3.5, §5.2).
//
// The sheet IS the project's current state: `project_offer_companies` are its
// columns, `project_offer_prices` its cells, and there is no round or version
// entity behind them. This file owns the queue down the left of the Offer
// Processing page, the grid on the right, and the three writes that change it.
//
// Prices are stored canonically in EUR with the same entered_amount /
// entered_currency / rate_used / rate_date provenance as `stock_entries`, and
// through the same `convertToEur`: one part bought in RON and quoted in RON
// must compare against one bought in EUR, and the only way that holds is if
// every price in the system is reduced to euros at a rate that is written
// down beside it.
import { Router } from 'express';
import {
  query,
  pool,
  withTransaction,
  isUniqueViolation,
  isForeignKeyViolation,
  type Queryable,
} from '../db.js';
import type { PoolClient } from 'pg';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import { requireId } from './routeParams.js';
import {
  lockProject,
  lockProjectForPartsWrite,
  requireStartedForPartsWrite,
} from './projectAccess.js';
import {
  offerCompanyInputSchema,
  offerPricesPayloadSchema,
  type OfferPriceCell,
} from '../schemas/projectOffers.schema.js';
import type { ProjectStatus } from '../schemas/projects.schema.js';
import { convertToEur } from '../services/exchangeRates.js';
import { loadBoardCards } from '../services/projectBoard.js';
import type { ProjectBomPartInfo } from '../services/projectBom.js';

const router = Router();

/** One dynamic column. `id` is the `project_offer_companies` row, which is
 *  what a cell is keyed by — not the company, which can be a column of many
 *  projects at once. */
interface OfferCompanyColumn {
  id: number;
  companyId: number;
  name: string;
  position: number;
}

/** One cell: canonical EUR, plus the provenance that says how it got there. */
interface OfferPrice {
  pricePerPiece: number;
  enteredAmount: number;
  enteredCurrency: string;
  rateUsed: number | null;
  rateDate: string | null;
  updatedAt: string;
}

/** §5.2's hint — what the part actually costs, so a quote can be judged
 *  without leaving the page. */
interface ReferencePrice {
  pricePerPiece: number;
  company: string;
  onDate: string;
  /** `paid` is a settled receipt, `quoted` another project's open offer. The
   *  grid greys them differently: one is a fact, the other is an ask. */
  source: 'paid' | 'quoted';
}

interface OfferRow {
  projectPartId: number;
  part: ProjectBomPartInfo;
  /** `project_parts.missing_qty` — the same number the Parts table edits, not
   *  a second one (§6.5). */
  quantity: number;
  /** How much of `quantity` is already on order. The grid needs it to bound
   *  the Order Parts modal, and to total a basket over what is still buyable
   *  rather than over what was bought weeks ago. */
  orderedQty: number;
  referencePrice: ReferencePrice | null;
  /** Keyed by `offer_company_id`; an absent key is an absent quote, which is
   *  also what an absent row means (§3.5). */
  prices: Record<number, OfferPrice>;
}

export interface ReferencePriceRow {
  partId: number;
  pricePerPiece: string;
  onDate: string;
  company: string;
}

/**
 * `referencePrice` for every part on the page at once (§5.2): the last price
 * actually paid, falling back to the newest quote from any OTHER project when
 * the part has never been bought.
 *
 * Two statements over the whole id list, never one pair per row — at a few
 * hundred parts that difference is the page loading or not. Both are served
 * by existing indexes (`idx_stock_entries_part_id`,
 * `idx_project_offer_prices_part`).
 */
async function loadReferencePrices(
  db: Queryable,
  projectId: number,
  partIds: number[],
): Promise<Map<number, ReferencePrice>> {
  if (partIds.length === 0) return new Map();

  const [paid, quoted] = await Promise.all([
    // A plain JOIN on companies is safe: chk_received_requires_company makes
    // company_id NOT NULL for exactly the rows this reads.
    db.query<ReferencePriceRow>(
      `SELECT DISTINCT ON (se.part_id)
         se.part_id AS "partId", se.price_per_piece AS "pricePerPiece",
         to_char(se.entered_at, 'YYYY-MM-DD') AS "onDate", c.name AS company
       FROM stock_entries se
       JOIN companies c ON c.id = se.company_id
       WHERE se.type = 'received' AND se.part_id = ANY($1::int[])
       ORDER BY se.part_id, se.entered_at DESC`,
      [partIds],
    ),
    db.query<ReferencePriceRow>(
      `SELECT DISTINCT ON (pp.part_id)
         pp.part_id AS "partId", pop.price_per_piece AS "pricePerPiece",
         to_char(pop.updated_at, 'YYYY-MM-DD') AS "onDate", c.name AS company
       FROM project_offer_prices pop
       JOIN project_parts pp ON pp.id = pop.project_part_id
       JOIN project_offer_companies poc ON poc.id = pop.offer_company_id
       JOIN companies c ON c.id = poc.company_id
       WHERE pop.price_per_piece IS NOT NULL
         AND pp.part_id = ANY($1::int[])
         AND pp.project_id <> $2
       ORDER BY pp.part_id, pop.updated_at DESC`,
      [partIds, projectId],
    ),
  ]);

  return mergeReferencePrices(paid.rows, quoted.rows);
}

/**
 * Paid beats quoted, per part. Separated from the two queries above because
 * the precedence is the whole rule — swap the two loops and every part that
 * has both a receipt and a foreign quote silently starts reporting the ask
 * instead of the price, which no query test would notice.
 */
export function mergeReferencePrices(
  paid: ReferencePriceRow[],
  quoted: ReferencePriceRow[],
): Map<number, ReferencePrice> {
  const byPart = new Map<number, ReferencePrice>();
  // Quotes go in first so the preferred answer overwrites them, rather than
  // the fallback needing to ask what is already in the map.
  for (const row of quoted) byPart.set(row.partId, toReferencePrice(row, 'quoted'));
  for (const row of paid) byPart.set(row.partId, toReferencePrice(row, 'paid'));
  return byPart;
}

function toReferencePrice(
  row: ReferencePriceRow,
  source: ReferencePrice['source'],
): ReferencePrice {
  return {
    pricePerPiece: Number(row.pricePerPiece),
    company: row.company,
    onDate: row.onDate,
    source,
  };
}

async function loadOfferCompanies(
  db: Queryable,
  projectId: number,
): Promise<OfferCompanyColumn[]> {
  const result = await db.query<OfferCompanyColumn>(
    `SELECT poc.id, poc.company_id AS "companyId", c.name, poc.position
     FROM project_offer_companies poc
     JOIN companies c ON c.id = poc.company_id
     WHERE poc.project_id = $1
     ORDER BY poc.position, poc.id`,
    [projectId],
  );
  return result.rows;
}

interface OfferPartRow {
  projectPartId: number;
  partId: number;
  partName: string;
  code: string;
  image: string | null;
  categoryId: number;
  categoryName: string;
  quantity: number;
  orderedQty: number;
}

/** A cell as Postgres hands it over — NUMERIC arrives as a string, and the
 *  grid's job is to take a MIN across a row and a SUM down a column. */
interface RawOfferPriceRow {
  projectPartId: number;
  offerCompanyId: number;
  pricePerPiece: string;
  enteredAmount: string;
  enteredCurrency: string;
  rateUsed: string | null;
  rateDate: string | null;
  updatedAt: string;
}

function toOfferPrice(row: RawOfferPriceRow): OfferPrice {
  return {
    pricePerPiece: Number(row.pricePerPiece),
    enteredAmount: Number(row.enteredAmount),
    enteredCurrency: row.enteredCurrency,
    rateUsed: row.rateUsed === null ? null : Number(row.rateUsed),
    rateDate: row.rateDate,
    updatedAt: row.updatedAt,
  };
}

/** The project's status, or 404. */
async function requireProjectStatus(projectId: number): Promise<ProjectStatus> {
  const result = await query<{ status: ProjectStatus }>(
    `SELECT status FROM projects WHERE id = $1`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project) throw new ApiError(404, ErrorCodes.PROJECT_NOT_FOUND);
  return project.status;
}

// GET /api/projects/offer-queue — the list down the left of the page (§5.2,
// §6.5). It is the board's *Offers* column and nothing else, so it is read
// through `loadBoardCards` rather than from its own
// `missing_qty > ordered_qty` query: that predicate is the column membership
// rule, and services/projectBoard.ts exists precisely so there is one copy of
// it. The cards already carry `toBuyLines`, which is what the list shows.
//
// Registered before `projects.ts` in server.ts, or its `/:id` would answer
// this path with a 400 for an id that is plainly a word.
router.get('/offer-queue', requireAuth, async (_req, res) => {
  const cards = await loadBoardCards(pool, { statuses: ['started'] });
  res.json(cards.filter((card) => card.inOffers));
});

// GET /api/projects/:id/offer — the grid (§5.2).
router.get('/:id/offer', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const status = await requireProjectStatus(projectId);
  // A draft has no `project_parts` rows for cells to point at, so its grid is
  // not empty — it cannot exist. A stopped project's grid is still served:
  // the quotes it collected are a record, and read-only is the page's call.
  if (status === 'draft') throw new ApiError(409, ErrorCodes.PROJECT_PARTS_NOT_FROZEN);

  // Only the lines still to buy. A fully ordered part has left the grid
  // (§6.5) — the same predicate that puts the project in the queue above.
  const partsResult = await query<OfferPartRow>(
    `SELECT pp.id AS "projectPartId", pp.part_id AS "partId", p.name AS "partName",
       p.code, p.image, p.category_id AS "categoryId", pc.name AS "categoryName",
       pp.missing_qty AS quantity, pp.ordered_qty AS "orderedQty"
     FROM project_parts pp
     JOIN parts p ON p.id = pp.part_id
     JOIN part_categories pc ON pc.id = p.category_id
     WHERE pp.project_id = $1 AND pp.missing_qty > pp.ordered_qty
     ORDER BY p.name, p.id`,
    [projectId],
  );

  const projectPartIds = partsResult.rows.map((row) => row.projectPartId);
  const [companies, pricesResult, referencePrices] = await Promise.all([
    loadOfferCompanies(pool, projectId),
    query<RawOfferPriceRow>(
      `SELECT project_part_id AS "projectPartId", offer_company_id AS "offerCompanyId",
         price_per_piece AS "pricePerPiece", entered_amount AS "enteredAmount",
         entered_currency AS "enteredCurrency", rate_used AS "rateUsed",
         to_char(rate_date, 'YYYY-MM-DD') AS "rateDate", updated_at AS "updatedAt"
       FROM project_offer_prices
       WHERE project_id = $1 AND project_part_id = ANY($2::int[])`,
      [projectId, projectPartIds],
    ),
    loadReferencePrices(
      pool,
      projectId,
      partsResult.rows.map((row) => row.partId),
    ),
  ]);

  const pricesByPart = new Map<number, Record<number, OfferPrice>>();
  for (const row of pricesResult.rows) {
    const cells = pricesByPart.get(row.projectPartId) ?? {};
    cells[row.offerCompanyId] = toOfferPrice(row);
    pricesByPart.set(row.projectPartId, cells);
  }

  const rows: OfferRow[] = partsResult.rows.map((row) => ({
    projectPartId: row.projectPartId,
    part: {
      id: row.partId,
      name: row.partName,
      code: row.code,
      image: row.image ?? null,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
    },
    quantity: row.quantity,
    orderedQty: row.orderedQty,
    referencePrice: referencePrices.get(row.partId) ?? null,
    prices: pricesByPart.get(row.projectPartId) ?? {},
  }));

  res.json({ status, companies, rows });
});

// POST /api/projects/:id/offer/companies — add a column (§5.2).
router.post('/:id/offer/companies', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const { companyId } = offerCompanyInputSchema.parse(req.body);

  const column = await withTransaction(async (client) => {
    await lockProjectForPartsWrite(client, projectId);
    try {
      // MAX + 1 is not serialised by the shared lock, so two columns added at
      // once can tie. Harmless: every ordering of the columns breaks the tie
      // on `id`.
      const result = await client.query<OfferCompanyColumn>(
        `WITH inserted AS (
           INSERT INTO project_offer_companies (project_id, company_id, position)
           VALUES ($1, $2, COALESCE(
             (SELECT MAX(position) + 1 FROM project_offer_companies WHERE project_id = $1), 0))
           RETURNING id, company_id, position
         )
         SELECT i.id, i.company_id AS "companyId", c.name, i.position
         FROM inserted i
         JOIN companies c ON c.id = i.company_id`,
        [projectId, companyId],
      );
      return result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(409, ErrorCodes.OFFER_COMPANY_ALREADY_ADDED);
      }
      if (isForeignKeyViolation(err)) {
        throw new ApiError(404, ErrorCodes.COMPANY_NOT_FOUND);
      }
      throw err;
    }
  });

  res.status(201).json(column);
});

// DELETE /api/projects/:id/offer/companies/:offerCompanyId — drop a column
// and, by the composite FK's ON DELETE CASCADE, every price in it (§3.5).
router.delete('/:id/offer/companies/:offerCompanyId', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const offerCompanyId = requireId(
    req.params.offerCompanyId,
    ErrorCodes.OFFER_COMPANY_NOT_FOUND,
  );

  const removed = await withTransaction(async (client) => {
    // The project's big lock, not the shared one the other two writes take.
    // The refusal below is a SELECT on `orders` with nothing in the schema
    // behind it — `order_lines` never points back at the offer column (§5.2)
    // — so an order placed between the check and the DELETE would take its
    // supplier's quotes down with it. Placing an order has to take the
    // project's lock as well (story 13); FOR UPDATE is what then makes the
    // two take turns.
    const project = await lockProject(client, projectId);
    requireStartedForPartsWrite(project.status);

    const columnResult = await client.query<{ companyId: number }>(
      `SELECT company_id AS "companyId" FROM project_offer_companies
       WHERE id = $1 AND project_id = $2`,
      [offerCompanyId, projectId],
    );
    const column = columnResult.rows[0];
    if (!column) throw new ApiError(404, ErrorCodes.OFFER_COMPANY_NOT_FOUND);

    const inUse = await client.query(
      `SELECT 1 FROM orders WHERE project_id = $1 AND company_id = $2 LIMIT 1`,
      [projectId, column.companyId],
    );
    if (inUse.rows.length > 0) throw new ApiError(409, ErrorCodes.OFFER_COMPANY_IN_USE);

    await client.query(`DELETE FROM project_offer_companies WHERE id = $1`, [offerCompanyId]);
    return { id: offerCompanyId };
  });

  res.json(removed);
});

/** A cell with its price already reduced to canonical EUR, ready to write.
 *  `amount` narrows to a number: a cleared cell never reaches the insert. */
interface ConvertedCell extends Omit<OfferPriceCell, 'amount'> {
  amount: number;
  priceEur: number;
  rateUsed: number | null;
  rateDate: string | null;
}

/**
 * Reduce every quoted cell to canonical EUR before the transaction opens.
 *
 * Sequential on purpose. `convertToEur` fetches BNR and caches the day's rate
 * the first time it needs one, so the first RON cell pays for the rest;
 * running the batch concurrently would instead have every cell of a pasted
 * column miss the empty cache and call bnr.ro at once. EUR needs no lookup at
 * all, which is the common case.
 *
 * Outside the transaction for the same reason it is not inside `stock_entries`
 * either: this can reach the network, and a project lock held across an
 * outbound HTTP call is a lock held for as long as bnr.ro feels like taking.
 */
async function convertCells(cells: OfferPriceCell[]): Promise<ConvertedCell[]> {
  const converted: ConvertedCell[] = [];
  for (const cell of cells) {
    const { amount } = cell;
    if (amount === null) continue;
    const price = await convertToEur(amount, cell.currency);
    converted.push({
      ...cell,
      amount,
      priceEur: price.priceEur,
      rateUsed: price.rateUsed,
      rateDate: price.rateDate,
    });
  }
  return converted;
}

/**
 * Both id lists belong to this project, or a 404 that says which one doesn't.
 *
 * The composite FKs (§3.5) already make a cell that pairs one project's column
 * with another's part un-representable, but a constraint reports a name, not a
 * reason: without this the ordinary case of a stale grid posting into a column
 * someone else removed reaches the user as a bare 500.
 */
async function assertCellTargets(
  client: PoolClient,
  projectId: number,
  cells: OfferPriceCell[],
): Promise<void> {
  const offerCompanyIds = [...new Set(cells.map((cell) => cell.offerCompanyId))];
  const projectPartIds = [...new Set(cells.map((cell) => cell.projectPartId))];

  const columns = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM project_offer_companies
     WHERE project_id = $1 AND id = ANY($2::int[])`,
    [projectId, offerCompanyIds],
  );
  if (columns.rows[0].n !== offerCompanyIds.length) {
    throw new ApiError(404, ErrorCodes.OFFER_COMPANY_NOT_FOUND);
  }

  const parts = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM project_parts
     WHERE project_id = $1 AND id = ANY($2::int[])`,
    [projectId, projectPartIds],
  );
  if (parts.rows[0].n !== projectPartIds.length) {
    throw new ApiError(404, ErrorCodes.PROJECT_PART_NOT_FOUND);
  }
}

// PUT /api/projects/:id/offer/prices — a whole edited column in one request
// (§5.2). Two statements, one transaction: the cleared cells are deleted and
// the quoted ones upserted, so a paste that fills 47 rows and blanks 3 is one
// round trip and one outcome.
router.put('/:id/offer/prices', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const { prices } = offerPricesPayloadSchema.parse(req.body);

  const cleared = prices.filter((cell) => cell.amount === null);
  const converted = await convertCells(prices);

  const written = await withTransaction(async (client) => {
    await lockProjectForPartsWrite(client, projectId);
    await assertCellTargets(client, projectId, prices);

    if (cleared.length > 0) {
      // A cleared cell deletes its row: a missing row and a NULL price are the
      // same thing, and keeping the row would be a second way to spell it.
      await client.query(
        `DELETE FROM project_offer_prices
         WHERE project_id = $1
           AND (offer_company_id, project_part_id) IN (
             SELECT * FROM unnest($2::int[], $3::int[]))`,
        [
          projectId,
          cleared.map((cell) => cell.offerCompanyId),
          cleared.map((cell) => cell.projectPartId),
        ],
      );
    }

    if (converted.length === 0) return [];

    const result = await client.query<RawOfferPriceRow>(
      `INSERT INTO project_offer_prices
         (project_id, offer_company_id, project_part_id, price_per_piece,
          entered_amount, entered_currency, rate_used, rate_date)
       SELECT $1::int, * FROM unnest(
         $2::int[], $3::int[], $4::numeric[], $5::numeric[], $6::text[],
         $7::numeric[], $8::date[])
       ON CONFLICT (offer_company_id, project_part_id) DO UPDATE SET
         price_per_piece  = EXCLUDED.price_per_piece,
         entered_amount   = EXCLUDED.entered_amount,
         entered_currency = EXCLUDED.entered_currency,
         rate_used        = EXCLUDED.rate_used,
         rate_date        = EXCLUDED.rate_date,
         updated_at       = NOW()
       RETURNING project_part_id AS "projectPartId", offer_company_id AS "offerCompanyId",
         price_per_piece AS "pricePerPiece", entered_amount AS "enteredAmount",
         entered_currency AS "enteredCurrency", rate_used AS "rateUsed",
         to_char(rate_date, 'YYYY-MM-DD') AS "rateDate", updated_at AS "updatedAt"`,
      [
        projectId,
        converted.map((cell) => cell.offerCompanyId),
        converted.map((cell) => cell.projectPartId),
        converted.map((cell) => cell.priceEur),
        converted.map((cell) => cell.amount),
        converted.map((cell) => cell.currency),
        converted.map((cell) => cell.rateUsed),
        converted.map((cell) => cell.rateDate),
      ],
    );
    return result.rows;
  });

  // Every cell the request touched, in the shape the grid holds them — the
  // canonical EUR of a price typed in RON is computed here and nowhere else,
  // so the browser patches its cache with this rather than guessing at the
  // rate or refetching the whole grid.
  res.json({
    prices: [
      ...cleared.map((cell) => ({
        offerCompanyId: cell.offerCompanyId,
        projectPartId: cell.projectPartId,
        price: null,
      })),
      ...written.map((row) => ({
        offerCompanyId: row.offerCompanyId,
        projectPartId: row.projectPartId,
        price: toOfferPrice(row),
      })),
    ],
  });
});

export default router;
