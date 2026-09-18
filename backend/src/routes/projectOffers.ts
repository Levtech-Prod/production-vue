// Project offers — the quote grid's HTTP layer (projects-preparation-plan.md
// §5.2). The queries live in `services/projectOffers.ts`; this file owns the
// route table, the locks each write takes, and the shape of the answers.
//
// Prices are stored canonically in EUR with the same entered_amount /
// entered_currency / rate_used / rate_date provenance as `stock_entries`, and
// through the same `convertToEur`: one part bought in RON and quoted in RON
// must compare against one bought in EUR, and the only way that holds is if
// every price in the system is reduced to euros at a rate that is written
// down beside it.
import { Router } from 'express';
import { query, pool, withTransaction } from '../db.js';
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
} from '../schemas/projectOffers.schema.js';
import type { ProjectStatus } from '../schemas/projects.schema.js';
import { loadBoardCards } from '../services/projectBoard.js';
import { currentRonPerEur } from '../services/exchangeRates.js';
import {
  addOfferCompany,
  convertOfferCells,
  loadOfferGrid,
  removeOfferCompany,
  writeOfferPrices,
} from '../services/projectOffers.js';

const router = Router();

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
// §6.5). It is the board's *Offers* column and nothing else, so membership is
// read through `loadBoardCards` rather than from its own
// `missing_qty > ordered_qty` query: that predicate is the column membership
// rule, and services/projectBoard.ts exists precisely so there is one copy of
// it. `withSubProducts: false` skips the half of the board this list never
// shows, and the projection below is the whole of what it does show.
//
// Registered before `projects.ts` in server.ts, or its `/:id` would answer
// this path with a 400 for an id that is plainly a word.
router.get('/offer-queue', requireAuth, async (_req, res) => {
  const cards = await loadBoardCards(pool, { statuses: ['started'], withSubProducts: false });
  res.json(
    cards
      .filter((card) => card.inOffers)
      .map(({ id, name, description, deadline, createdAt, toBuyLines, onOrderLines }) => ({
        id,
        name,
        description,
        deadline,
        createdAt,
        toBuyLines,
        onOrderLines,
      })),
  );
});

// GET /api/projects/:id/offer — the grid (§5.2).
router.get('/:id/offer', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const status = await requireProjectStatus(projectId);
  // A draft has no `project_parts` rows for cells to point at, so its grid is
  // not empty — it cannot exist. A stopped project's grid is still served:
  // the quotes it collected are a record, and read-only is the page's call.
  if (status === 'draft') throw new ApiError(409, ErrorCodes.PROJECT_PARTS_NOT_FROZEN);

  const grid = await loadOfferGrid(pool, projectId, status);
  // Composed here rather than inside `loadOfferGrid`: the rate is not part of
  // the sheet, it is what the page needs to render a column of canonical-EUR
  // prices in RON when the buyer asks for RON. Null means that choice is
  // unavailable right now, not that a price is missing.
  res.json({ ...grid, ronPerEur: await currentRonPerEur() });
});

// POST /api/projects/:id/offer/companies — add a column (§5.2).
router.post('/:id/offer/companies', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const { companyId } = offerCompanyInputSchema.parse(req.body);

  const column = await withTransaction(async (client) => {
    await lockProjectForPartsWrite(client, projectId);
    return addOfferCompany(client, projectId, companyId);
  });

  res.status(201).json(column);
});

// DELETE /api/projects/:id/offer/companies/:offerCompanyId — drop a column
// and its prices (§3.5).
router.delete('/:id/offer/companies/:offerCompanyId', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const offerCompanyId = requireId(
    req.params.offerCompanyId,
    ErrorCodes.OFFER_COMPANY_NOT_FOUND,
  );

  const removed = await withTransaction(async (client) => {
    // The project's big lock, not the shared one the other two writes take.
    // The in-use refusal is a SELECT on `orders` with nothing in the schema
    // behind it, so an order placed between the check and the DELETE would
    // take its supplier's quotes down with it. Placing an order has to take
    // the project's lock as well (story 13); FOR UPDATE is what then makes
    // the two take turns.
    const project = await lockProject(client, projectId);
    requireStartedForPartsWrite(project.status);
    return removeOfferCompany(client, projectId, offerCompanyId);
  });

  res.json(removed);
});

// PUT /api/projects/:id/offer/prices — a whole edited column in one request
// (§5.2).
router.put('/:id/offer/prices', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const { prices } = offerPricesPayloadSchema.parse(req.body);

  const converted = await convertOfferCells(prices);
  const written = await withTransaction(async (client) => {
    await lockProjectForPartsWrite(client, projectId);
    return writeOfferPrices(client, projectId, prices, converted);
  });

  // Every cell the request touched, in the shape the grid holds them — the
  // canonical EUR of a price typed in RON is computed here and nowhere else,
  // so the browser patches its cache with this rather than guessing at the
  // rate or refetching the whole grid.
  res.json({ prices: written });
});

export default router;
