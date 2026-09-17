// The offer grid's data access (projects-preparation-plan.md §3.5, §5.2).
//
// The sheet IS the project's current state: `project_offer_companies` are its
// columns, `project_offer_prices` its cells, and there is no round or version
// entity behind them.
//
// This is a service and not four query strings inside Express handlers for one
// reason: the bulk write below is an eight-column INSERT fed by eight
// POSITIONAL `unnest` arrays, and adding a ninth column without reordering the
// arrays would file `entered_amount` under `entered_currency` in silence. That
// is only catchable by running it against a real database, and a test can only
// run what it can call. `projectOffers.test.ts` calls these functions;
// `routes/projectOffers.ts` owns the HTTP around them and nothing else.
import type { PoolClient } from 'pg';
import { isForeignKeyViolation, isUniqueViolation, type Queryable } from '../db.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import type { ProjectStatus } from '../schemas/projects.schema.js';
import type { OfferPriceCell } from '../schemas/projectOffers.schema.js';
import { convertToEur } from './exchangeRates.js';
import type { ProjectBomPartInfo } from './projectBom.js';

/**
 * The day part of a timestamptz, in Bucharest — the timezone
 * `exchangeRates.bucharestToday()` already decided this module counts days in.
 * Rendered in the server's own timezone instead (UTC in the container), a
 * receipt entered after 21:00 local reads as the previous day, one day off
 * from the stock history the buyer is comparing it against.
 *
 * `column` is an identifier from a literal call site in this file, never from
 * request data — the one thing a bind parameter cannot carry.
 */
const localDay = (column: string) =>
  `to_char(${column} AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD')`;

/** One dynamic column. `id` is the `project_offer_companies` row, which is
 *  what a cell is keyed by — not the company, which can be a column of many
 *  projects at once. */
export interface OfferCompanyColumn {
  id: number;
  companyId: number;
  name: string;
  position: number;
}

/** One cell: canonical EUR, plus the provenance that says how it got there. */
export interface OfferPrice {
  pricePerPiece: number;
  enteredAmount: number;
  enteredCurrency: string;
  rateUsed: number | null;
  rateDate: string | null;
  updatedAt: string;
}

/** §5.2's hint — what the part actually costs, so a quote can be judged
 *  without leaving the page. */
export interface ReferencePrice {
  pricePerPiece: number;
  company: string;
  onDate: string;
  /** `paid` is a settled receipt, `quoted` another project's open offer. The
   *  grid greys them differently: one is a fact, the other is an ask. */
  source: 'paid' | 'quoted';
}

export interface OfferRow {
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

export interface OfferGrid {
  status: ProjectStatus;
  companies: OfferCompanyColumn[];
  rows: OfferRow[];
}

export interface ReferencePriceRow {
  partId: number;
  pricePerPiece: string;
  onDate: string;
  company: string;
}

/** A cell with its price already reduced to canonical EUR, ready to write.
 *  `amount` narrows to a number: a cleared cell never reaches the insert. */
export interface ConvertedOfferCell extends Omit<OfferPriceCell, 'amount'> {
  amount: number;
  priceEur: number;
  rateUsed: number | null;
  rateDate: string | null;
}

/**
 * Reduce every quoted cell to canonical EUR, dropping the cleared ones.
 *
 * Sequential on purpose. `convertToEur` fetches BNR and caches the day's rate
 * the first time it needs one, so the first RON cell pays for the rest;
 * running the batch concurrently would instead have every cell of a pasted
 * column miss the empty cache and call bnr.ro at once. EUR needs no lookup at
 * all, which is the common case.
 *
 * Called before the transaction opens, for the same reason `stock_entries`
 * converts outside one: this can reach the network, and a project lock held
 * across an outbound HTTP call is held for as long as bnr.ro feels like
 * taking.
 */
export async function convertOfferCells(
  cells: OfferPriceCell[],
): Promise<ConvertedOfferCell[]> {
  const converted: ConvertedOfferCell[] = [];
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
 * `referencePrice` for every part on the page at once (§5.2): the last price
 * actually paid, falling back to the newest quote from any OTHER project when
 * the part has never been bought.
 *
 * Two statements over the whole id list, never one pair per row — at a few
 * hundred parts that difference is the page loading or not.
 */
export async function loadReferencePrices(
  db: Queryable,
  projectId: number,
  partIds: number[],
): Promise<Map<number, ReferencePrice>> {
  if (partIds.length === 0) return new Map();

  // Sequential, not Promise.all. `db` is the pool in production but a single
  // client under test, and pg deprecates overlapping queries on one client
  // (removed in pg@9). Two indexed reads in series cost less than a function
  // that only works on one of the two things its type accepts.
  //
  // A plain JOIN on companies is safe: chk_received_requires_company makes
  // company_id NOT NULL for exactly the rows this reads.
  const paid = await db.query<ReferencePriceRow>(
    `SELECT DISTINCT ON (se.part_id)
       se.part_id AS "partId", se.price_per_piece AS "pricePerPiece",
       ${localDay('se.entered_at')} AS "onDate", c.name AS company
     FROM stock_entries se
     JOIN companies c ON c.id = se.company_id
     WHERE se.type = 'received' AND se.part_id = ANY($1::int[])
     ORDER BY se.part_id, se.entered_at DESC`,
    [partIds],
  );
  const quoted = await db.query<ReferencePriceRow>(
    `SELECT DISTINCT ON (pp.part_id)
       pp.part_id AS "partId", pop.price_per_piece AS "pricePerPiece",
       ${localDay('pop.updated_at')} AS "onDate", c.name AS company
     FROM project_offer_prices pop
     JOIN project_parts pp ON pp.id = pop.project_part_id
     JOIN project_offer_companies poc ON poc.id = pop.offer_company_id
     JOIN companies c ON c.id = poc.company_id
     WHERE pop.price_per_piece IS NOT NULL
       AND pp.part_id = ANY($1::int[])
       AND pp.project_id <> $2
     ORDER BY pp.part_id, pop.updated_at DESC`,
    [partIds, projectId],
  );

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

export async function loadOfferCompanies(
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

const SELECT_CELL = `
  project_part_id AS "projectPartId", offer_company_id AS "offerCompanyId",
  price_per_piece AS "pricePerPiece", entered_amount AS "enteredAmount",
  entered_currency AS "enteredCurrency", rate_used AS "rateUsed",
  to_char(rate_date, 'YYYY-MM-DD') AS "rateDate", updated_at AS "updatedAt"
`;

export function toOfferPrice(row: RawOfferPriceRow): OfferPrice {
  return {
    pricePerPiece: Number(row.pricePerPiece),
    enteredAmount: Number(row.enteredAmount),
    enteredCurrency: row.enteredCurrency,
    rateUsed: row.rateUsed === null ? null : Number(row.rateUsed),
    rateDate: row.rateDate,
    updatedAt: row.updatedAt,
  };
}

/** The whole grid for one project (§5.2). */
export async function loadOfferGrid(
  db: Queryable,
  projectId: number,
  status: ProjectStatus,
): Promise<OfferGrid> {
  // Only the lines still to buy. A fully ordered part has left the grid
  // (§6.5) — the same predicate that puts the project in the offer queue.
  const partsResult = await db.query<OfferPartRow>(
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
  const companies = await loadOfferCompanies(db, projectId);
  // `price_per_piece IS NOT NULL` is the read side of "a missing row and a
  // NULL price mean the same thing" (§3.5). Without it a NULL would reach the
  // grid through Number(null) as a real 0.00, and the frontend's
  // MIN-over-quoted-cells would hand the order to a company that never quoted
  // — the exact confusion the zero-is-a-real-price rule exists to prevent.
  const pricesResult = await db.query<RawOfferPriceRow>(
    `SELECT ${SELECT_CELL}
     FROM project_offer_prices
     WHERE project_id = $1 AND project_part_id = ANY($2::int[])
       AND price_per_piece IS NOT NULL`,
    [projectId, projectPartIds],
  );
  const referencePrices = await loadReferencePrices(
    db,
    projectId,
    partsResult.rows.map((row) => row.partId),
  );

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

  return { status, companies, rows };
}

/** Add a column (§5.2). */
export async function addOfferCompany(
  client: PoolClient,
  projectId: number,
  companyId: number,
): Promise<OfferCompanyColumn> {
  try {
    // MAX + 1 is not serialised by the project's shared lock, so two columns
    // added at once can tie. Harmless: every ordering of the columns breaks
    // the tie on `id`.
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
    if (isUniqueViolation(err)) throw new ApiError(409, ErrorCodes.OFFER_COMPANY_ALREADY_ADDED);
    if (isForeignKeyViolation(err)) throw new ApiError(404, ErrorCodes.COMPANY_NOT_FOUND);
    throw err;
  }
}

/**
 * Drop a column and, by the composite FK's ON DELETE CASCADE, every price in
 * it (§3.5).
 *
 * Refused once an order for this project exists at that company. That check is
 * a SELECT on `orders` with nothing in the schema behind it — `order_lines`
 * never points back at the offer column (§5.2) — so the caller has to hold the
 * project's exclusive lock for it to mean anything.
 */
export async function removeOfferCompany(
  client: PoolClient,
  projectId: number,
  offerCompanyId: number,
): Promise<{ id: number }> {
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

/** One cell as the write answers with it: the stored value, or null for a
 *  cell the request cleared. */
export interface OfferPriceResult {
  offerCompanyId: number;
  projectPartId: number;
  price: OfferPrice | null;
}

/**
 * A whole edited column in one transaction (§5.2): the cleared cells deleted
 * and the quoted ones upserted, so a paste that fills 47 rows and blanks 3 is
 * one round trip and one outcome.
 *
 * `cells` is the request as validated — its cleared entries decide the DELETE.
 * `converted` is the same cells with their prices already in canonical EUR;
 * they are passed in rather than converted here so the write never waits on
 * bnr.ro with the project locked.
 */
export async function writeOfferPrices(
  client: PoolClient,
  projectId: number,
  cells: OfferPriceCell[],
  converted: ConvertedOfferCell[],
): Promise<OfferPriceResult[]> {
  await assertCellTargets(client, projectId, cells);

  const cleared = cells.filter((cell) => cell.amount === null);
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

  const clearedResults: OfferPriceResult[] = cleared.map((cell) => ({
    offerCompanyId: cell.offerCompanyId,
    projectPartId: cell.projectPartId,
    price: null,
  }));
  if (converted.length === 0) return clearedResults;

  // EIGHT POSITIONAL ARRAYS. Their order is the column list above them, and
  // nothing but this line pairs the two — add a column here without adding its
  // array in the same position and the values shift one place to the left,
  // silently. `projectOffers.test.ts` asserts every column of a written row
  // for exactly that reason.
  const written = await client.query<RawOfferPriceRow>(
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
     RETURNING ${SELECT_CELL}`,
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

  return [
    ...clearedResults,
    ...written.rows.map((row) => ({
      offerCompanyId: row.offerCompanyId,
      projectPartId: row.projectPartId,
      price: toOfferPrice(row),
    })),
  ];
}
