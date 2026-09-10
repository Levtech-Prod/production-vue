// ===========================================================================
// Project BOM — a project's flattened parts list, in both forms it has:
// computed live from the pinned revisions while the project is a draft, and
// read back from `project_parts` / `project_part_usages` once Start has
// frozen it (plan §3.4 for the aggregation, §5.3, §5.4). `freezeProjectBom`
// is the step between the two.
//
// Both readers answer with one `ProjectBomPart` shape and one mapper builds
// the payload from either, so the collapse to distinct products and the
// derived to-buy / on-order / to-pick figures exist once rather than once per
// branch. That is what lets the Parts table not care which form it got.
//
// Quantities are whole parts (INTEGER since migration 025), so the arithmetic
// here is exact and nothing needs rounding.
//
// `product-revisions/:revId/bom` was checked first and does not fit: it
// flattens ONE revision nested by sub-product, with no project quantities and
// no stock — a different question at a different grain.
// ===========================================================================
import type { PoolClient } from 'pg';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import type { Queryable } from '../db.js';
import type { ProjectStatus } from '../schemas/projects.schema.js';
import { getPartStock, type PartStock } from './projectStock.js';

/** One place a part is actually used: a (product-in-the-project, sub-product
 *  revision) pair — the grain of `project_part_usages` (§3.4). A part used in
 *  two sub-products of one product has two of these. */
export interface ProjectBomUsage {
  projectProductId: number;
  productId: number;
  sku: string;
  revisionLabel: string;
  subProductRevisionId: number;
  /** For one unit of the product, at this usage site alone. */
  qtyPerUnit: number;
  /** `project_products.quantity` — how many of that product the project builds. */
  productQuantity: number;
}

export interface ProjectBomPartInfo {
  id: number;
  name: string;
  code: string;
  image: string | null;
  categoryId: number;
  categoryName: string;
}

/** One distinct part in the whole project, with every place it is used —
 *  computed for a draft, read back from the frozen tables once started. */
export interface ProjectBomPart {
  /** `project_parts.id`, or null while the project is a draft and the row
   *  exists only in memory. Rows are keyed on `part.id`, which both forms
   *  have and `UNIQUE (project_id, part_id)` keeps unique. */
  id: number | null;
  part: ProjectBomPartInfo;
  requiredQty: number;
  fromStockQty: number;
  missingQty: number;
  missingQtyOverridden: boolean;
  orderedQty: number;
  receivedQty: number;
  preparedQty: number;
  stock: PartStock;
  usages: ProjectBomUsage[];
}

/** `GET /api/projects/:id/parts` (§5.4). `draft` says which form the rows
 *  were built from; nothing else about them differs. */
export interface ProjectPartsPayload {
  draft: boolean;
  rows: ProjectPartRow[];
}

/** A row of the Parts table (§5.4). */
export interface ProjectPartRow {
  id: number | null;
  part: ProjectBomPartInfo;
  products: {
    projectProductId: number;
    productId: number;
    sku: string;
    revisionLabel: string;
    qtyPerUnit: number;
    qtyForProduct: number;
  }[];
  requiredQty: number;
  availableQty: number;
  reservedQty: number;
  fromStockQty: number;
  missingQty: number;
  missingQtyOverridden: boolean;
  orderedQty: number;
  receivedQty: number;
  preparedQty: number;
  toBuyQty: number;
  onOrderQty: number;
  toPickQty: number;
  stockShortfall: boolean;
}

interface ComputedUsageRow {
  partId: number;
  partName: string;
  code: string;
  image: string | null;
  categoryId: number;
  categoryName: string;
  projectProductId: number;
  productId: number;
  sku: string;
  revisionLabel: string;
  subProductRevisionId: number;
  qtyPerUnit: number;
  productQuantity: number;
}

// §3.4's `usage` CTE with the display columns joined on. No GROUP BY: the two
// junction tables' UNIQUE constraints already make every row a distinct usage
// site.
const COMPUTE_USAGES = `
  SELECT
    p.id                        AS "partId",
    p.name                      AS "partName",
    p.code,
    p.image,
    p.category_id               AS "categoryId",
    pc.name                     AS "categoryName",
    pp.id                       AS "projectProductId",
    pp.product_id               AS "productId",
    prod.sku,
    rev.label                   AS "revisionLabel",
    prsp.sub_product_revision_id AS "subProductRevisionId",
    sprp.quantity               AS "qtyPerUnit",
    pp.quantity                 AS "productQuantity"
  FROM project_products pp
  JOIN products prod ON prod.id = pp.product_id
  JOIN product_revisions rev ON rev.id = pp.product_revision_id
  JOIN product_revision_sub_products prsp
    ON prsp.product_revision_id = pp.product_revision_id
  JOIN sub_product_revision_parts sprp
    ON sprp.sub_product_revision_id = prsp.sub_product_revision_id
  JOIN parts p ON p.id = sprp.part_id
  JOIN part_categories pc ON pc.id = p.category_id
  WHERE pp.project_id = $1
  ORDER BY p.name, p.id, pp.position, pp.id
`;

interface FrozenPartRow {
  id: number;
  partId: number;
  partName: string;
  code: string;
  image: string | null;
  categoryId: number;
  categoryName: string;
  requiredQty: number;
  fromStockQty: number;
  missingQty: number;
  missingQtyOverridden: boolean;
  orderedQty: number;
  receivedQty: number;
  preparedQty: number;
}

interface FrozenUsageRow {
  projectPartId: number;
  projectProductId: number;
  productId: number;
  sku: string;
  revisionLabel: string;
  subProductRevisionId: number;
  qtyPerUnit: number;
  productQuantity: number;
}

/** Group flat usage rows by part, preserving the query's ordering. */
function groupUsages(
  rows: ComputedUsageRow[],
): Map<number, { part: ProjectBomPartInfo; usages: ProjectBomUsage[] }> {
  const byPart = new Map<number, { part: ProjectBomPartInfo; usages: ProjectBomUsage[] }>();
  for (const row of rows) {
    let entry = byPart.get(row.partId);
    if (!entry) {
      entry = {
        part: {
          id: row.partId,
          name: row.partName,
          code: row.code,
          image: row.image ?? null,
          categoryId: row.categoryId,
          categoryName: row.categoryName,
        },
        usages: [],
      };
      byPart.set(row.partId, entry);
    }
    entry.usages.push({
      projectProductId: row.projectProductId,
      productId: row.productId,
      sku: row.sku,
      revisionLabel: row.revisionLabel,
      subProductRevisionId: row.subProductRevisionId,
      qtyPerUnit: row.qtyPerUnit,
      productQuantity: row.productQuantity,
    });
  }
  return byPart;
}

/** Level 3: what the whole project needs of a part. */
function requiredFrom(usages: ProjectBomUsage[]): number {
  return usages.reduce((sum, u) => sum + u.qtyPerUnit * u.productQuantity, 0);
}

/**
 * §5.3's seed, shared by `computeProjectBom` (fresh, floors at zero) and
 * `reseedFromStock` (floors `missing_qty` at `ordered_qty` instead, so a
 * recalculate can never undo an order that already exists — §3.3, and
 * `from_stock_qty` at `minFromStockQty` — the same
 * `chk_project_parts_prepared_within_pickable` floor `resolveProjectPartUpdate`
 * enforces on a manual PATCH, so an automatic re-seed can't trip it either).
 * Claim `MIN(requiredQty, free stock)`, never negative — a stale reservation
 * can leave `free` below zero (§11.8) — then raise it to `minFromStockQty` if
 * that floor asks for more than free stock offered; `missing_qty` is derived
 * from the (possibly raised) claim, floored at `minMissingQty`, and stays
 * non-negative even when the floor pushes `from_stock_qty` past `requiredQty`.
 */
function seedFromFreeStock(
  requiredQty: number,
  free: number,
  minMissingQty: number,
  minFromStockQty = 0,
): { fromStockQty: number; missingQty: number } {
  const claimed = Math.max(0, Math.min(requiredQty, Math.max(0, free)));
  const fromStockQty = Math.max(claimed, minFromStockQty);
  const missingQty = Math.max(requiredQty - fromStockQty, minMissingQty);
  return { fromStockQty, missingQty };
}

/** The parts list computed from the pinned revisions, seeded from today's free
 *  stock with the progress buckets at zero (§5.3). Writes nothing — Start
 *  re-runs it inside its transaction rather than trust the browser. */
export async function computeProjectBom(
  db: Queryable,
  projectId: number,
): Promise<ProjectBomPart[]> {
  const usageResult = await db.query<ComputedUsageRow>(COMPUTE_USAGES, [projectId]);
  const byPart = groupUsages(usageResult.rows);
  if (byPart.size === 0) return [];

  const stock = await getPartStock(db, [...byPart.keys()], projectId);

  return [...byPart.values()].map(({ part, usages }) => {
    const requiredQty = requiredFrom(usages);
    const partStock = stock.get(part.id) ?? { available: 0, reserved: 0, free: 0 };
    // §11.5: a BOM line of <= 0 is still representable. `requiredQty` is left
    // exactly as computed — the CHECK at Start is what refuses it, and hiding
    // it here hides the reason.
    const { fromStockQty, missingQty } = seedFromFreeStock(requiredQty, partStock.free, 0);
    return {
      id: null,
      part,
      requiredQty,
      fromStockQty,
      missingQty,
      missingQtyOverridden: false,
      orderedQty: 0,
      receivedQty: 0,
      preparedQty: 0,
      stock: partStock,
      usages,
    };
  });
}

// Serialises every project start against every other, so two of them cannot
// read the same free stock and both claim the last five capacitors (§5.3.5).
// One fixed key rather than a lock per part: starts run a handful of times a
// day, and per-part locks would have to be acquired in a fixed order to stay
// deadlock-free.
const PROJECT_START_LOCK_KEY = 23_000_001;

/**
 * Persist what `computeProjectBom` produces into `project_parts` /
 * `project_part_usages`, seeded from today's free stock (§5.3).
 *
 * Must run inside the Start transaction, which is why it takes a client and
 * not a `Queryable`: the advisory lock is held only until that transaction
 * ends, and the seeded claims are only true if the status flip commits with
 * them. Returns the number of part rows written.
 *
 * Both ways a project can fail to freeze are refused here rather than left to
 * the table's constraints, because a constraint violation reaches the user as
 * a bare 500 that names nothing.
 */
export async function freezeProjectBom(
  client: PoolClient,
  projectId: number,
): Promise<number> {
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [PROJECT_START_LOCK_KEY]);

  // Recomputed rather than taking the numbers the browser is showing: stock
  // moves between opening the page and pressing Start. Under READ COMMITTED
  // this reads after any start that held the lock before us has committed, so
  // its claim is already part of `reserved`.
  const bom = await computeProjectBom(client, projectId);
  // No products, or products whose revisions carry no parts (§5.3).
  if (bom.length === 0) throw new ApiError(409, ErrorCodes.PROJECT_HAS_NO_PARTS);

  // §3.3's precondition: `sub_product_revision_parts.quantity` has no
  // positivity CHECK of its own, so a zero or negative BOM line is
  // representable in older data. `project_parts.required_qty > 0` would refuse
  // it a statement later as SQLSTATE 23514 — a 500 naming nothing — so it is
  // caught here instead, naming the parts whose quantity has to be fixed.
  const invalid = bom.filter((row) => row.requiredQty <= 0);
  if (invalid.length > 0) {
    throw new ApiError(409, ErrorCodes.PROJECT_BOM_QUANTITY_INVALID, {
      parts: invalid.map((row) => `${row.part.name} (${row.part.code})`).join(', '),
    });
  }

  // Two bulk inserts rather than §3.4's insert-from-select: that would be the
  // §3.4 aggregation written a second time, and the two would drift. The
  // usage rows need the ids the first insert assigns, so they could not share
  // one statement without re-deriving the join anyway.
  //
  // The progress buckets and `missing_qty_overridden` are left to their
  // column defaults — zero and false is exactly what Start means.
  const inserted = await client.query<{ id: number; partId: number }>(
    `INSERT INTO project_parts (project_id, part_id, required_qty, from_stock_qty, missing_qty)
     SELECT $1::int, part_id, required_qty, from_stock_qty, missing_qty
     FROM unnest($2::int[], $3::int[], $4::int[], $5::int[])
       AS t(part_id, required_qty, from_stock_qty, missing_qty)
     RETURNING id, part_id AS "partId"`,
    [
      projectId,
      bom.map((row) => row.part.id),
      bom.map((row) => row.requiredQty),
      bom.map((row) => row.fromStockQty),
      bom.map((row) => row.missingQty),
    ],
  );

  // RETURNING promises no ordering, so the usage rows are matched by part id.
  const projectPartIdByPart = new Map(inserted.rows.map((row) => [row.partId, row.id]));
  const usages = bom.flatMap((row) =>
    row.usages.map((usage) => ({
      projectPartId: projectPartIdByPart.get(row.part.id)!,
      usage,
    })),
  );

  await client.query(
    `INSERT INTO project_part_usages
       (project_part_id, project_product_id, sub_product_revision_id, qty_per_unit)
     SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[])`,
    [
      usages.map((u) => u.projectPartId),
      usages.map((u) => u.usage.projectProductId),
      usages.map((u) => u.usage.subProductRevisionId),
      usages.map((u) => u.usage.qtyPerUnit),
    ],
  );

  return bom.length;
}

/** The frozen parts list as Start stored it. `available` / `reserved` stay
 *  live: stock moves afterwards, and showing that is the table's job. */
export async function loadFrozenProjectBom(
  db: Queryable,
  projectId: number,
): Promise<ProjectBomPart[]> {
  const partsResult = await db.query<FrozenPartRow>(
    `SELECT pp.id, pp.part_id AS "partId", p.name AS "partName", p.code, p.image,
       p.category_id AS "categoryId", pc.name AS "categoryName",
       pp.required_qty AS "requiredQty", pp.from_stock_qty AS "fromStockQty",
       pp.missing_qty AS "missingQty",
       pp.missing_qty_overridden AS "missingQtyOverridden",
       pp.ordered_qty AS "orderedQty", pp.received_qty AS "receivedQty",
       pp.prepared_qty AS "preparedQty"
     FROM project_parts pp
     JOIN parts p ON p.id = pp.part_id
     JOIN part_categories pc ON pc.id = p.category_id
     WHERE pp.project_id = $1
     ORDER BY p.name, p.id`,
    [projectId],
  );
  if (partsResult.rows.length === 0) return [];

  const usagesResult = await db.query<FrozenUsageRow>(
    `SELECT ppu.project_part_id AS "projectPartId",
       ppu.project_product_id AS "projectProductId",
       pprod.product_id AS "productId", prod.sku, rev.label AS "revisionLabel",
       ppu.sub_product_revision_id AS "subProductRevisionId",
       ppu.qty_per_unit AS "qtyPerUnit", pprod.quantity AS "productQuantity"
     FROM project_part_usages ppu
     JOIN project_parts pp ON pp.id = ppu.project_part_id
     JOIN project_products pprod ON pprod.id = ppu.project_product_id
     JOIN products prod ON prod.id = pprod.product_id
     JOIN product_revisions rev ON rev.id = pprod.product_revision_id
     WHERE pp.project_id = $1
     ORDER BY pprod.position, pprod.id`,
    [projectId],
  );

  const usagesByPart = new Map<number, ProjectBomUsage[]>();
  for (const row of usagesResult.rows) {
    const usages = usagesByPart.get(row.projectPartId) ?? [];
    usages.push({
      projectProductId: row.projectProductId,
      productId: row.productId,
      sku: row.sku,
      revisionLabel: row.revisionLabel,
      subProductRevisionId: row.subProductRevisionId,
      qtyPerUnit: row.qtyPerUnit,
      productQuantity: row.productQuantity,
    });
    usagesByPart.set(row.projectPartId, usages);
  }

  const stock = await getPartStock(
    db,
    partsResult.rows.map((r) => r.partId),
    projectId,
  );

  return partsResult.rows.map((row) => ({
    id: row.id,
    part: {
      id: row.partId,
      name: row.partName,
      code: row.code,
      image: row.image ?? null,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
    },
    requiredQty: row.requiredQty,
    fromStockQty: row.fromStockQty,
    missingQty: row.missingQty,
    missingQtyOverridden: row.missingQtyOverridden,
    orderedQty: row.orderedQty,
    receivedQty: row.receivedQty,
    preparedQty: row.preparedQty,
    stock: stock.get(row.partId) ?? { available: 0, reserved: 0, free: 0 },
    usages: usagesByPart.get(row.id) ?? [],
  }));
}

/** Level 2 (§3.4): usages collapsed to distinct products, so a part in three
 *  sub-products of one product is one entry whose `qtyPerUnit` is their sum. */
function collapseToProducts(usages: ProjectBomUsage[]): ProjectPartRow['products'] {
  const byProduct = new Map<number, ProjectPartRow['products'][number]>();
  for (const usage of usages) {
    const existing = byProduct.get(usage.projectProductId);
    if (existing) {
      existing.qtyPerUnit += usage.qtyPerUnit;
      existing.qtyForProduct = existing.qtyPerUnit * usage.productQuantity;
      continue;
    }
    byProduct.set(usage.projectProductId, {
      projectProductId: usage.projectProductId,
      productId: usage.productId,
      sku: usage.sku,
      revisionLabel: usage.revisionLabel,
      qtyPerUnit: usage.qtyPerUnit,
      qtyForProduct: usage.qtyPerUnit * usage.productQuantity,
    });
  }
  return [...byProduct.values()];
}

/** The §5.4 payload, from either form. The derived quantities are computed
 *  here, not in the browser, so the table and the board cannot disagree. */
export function toProjectPartRows(
  parts: ProjectBomPart[],
  status: ProjectStatus,
): ProjectPartRow[] {
  // Only a claim someone else counts can fall short: §4.2 sums `reserved` over
  // started projects alone, so a stopped or completed project's numbers are a
  // record, not a claim. A draft's is prospective, and does flag.
  const claimIsCounted = status === 'draft' || status === 'started';
  return parts.map((row) => {
    // What this project itself still has an outstanding claim on — the same
    // expression §4.2 sums over OTHER started projects to get `reserved`, so
    // the shortfall test below compares like with like.
    const toPickQty = row.fromStockQty + row.receivedQty - row.preparedQty;
    return {
      id: row.id,
      part: row.part,
      products: collapseToProducts(row.usages),
      requiredQty: row.requiredQty,
      availableQty: row.stock.available,
      reservedQty: row.stock.reserved,
      fromStockQty: row.fromStockQty,
      missingQty: row.missingQty,
      missingQtyOverridden: row.missingQtyOverridden,
      orderedQty: row.orderedQty,
      receivedQty: row.receivedQty,
      preparedQty: row.preparedQty,
      toBuyQty: row.missingQty - row.orderedQty,
      onOrderQty: row.orderedQty - row.receivedQty,
      toPickQty,
      stockShortfall: claimIsCounted && row.stock.available < row.stock.reserved + toPickQty,
    };
  });
}

/** The payload for a project in whatever state it is in (§5.2). The switch
 *  lives here, not in the route: inverted, a started project would answer with
 *  recomputed rows carrying none of its progress — plausible, and wrong. */
export async function loadProjectPartsPayload(
  db: Queryable,
  projectId: number,
  status: ProjectStatus,
): Promise<ProjectPartsPayload> {
  const draft = status === 'draft';
  const bom = draft
    ? await computeProjectBom(db, projectId)
    : await loadFrozenProjectBom(db, projectId);
  return { draft, rows: toProjectPartRows(bom, status) };
}

export interface ResolvedProjectPartQty {
  fromStockQty: number;
  missingQty: number;
}

/**
 * Resolve `PATCH /:id/parts/:projectPartId`'s partial
 * `{ missingQty?, fromStockQty? }` (§5.2) against the row's current values,
 * and enforce both floors the table's CHECKs would otherwise refuse as an
 * unattributable constraint violation:
 *
 *  - `missing_qty` may never drop below `ordered_qty` (§3.3) — a line can
 *    never be made to owe less than it has already bought.
 *  - `from_stock_qty` may never drop below what has already been prepared
 *    from it net of what's been received (`chk_project_parts_prepared_within_pickable`:
 *    `prepared_qty <= from_stock_qty + received_qty`) — Preparation (phase 3)
 *    is what can make `prepared_qty` positive, but the guard belongs here now
 *    so this endpoint doesn't become the one way a fraction — sorry, a raw
 *    23514 — reaches the user as an unexplained 500.
 *
 * `missing_qty` is checked first, so it is the code thrown when a patch
 * breaks both floors at once — but that would otherwise hide the second
 * problem until the caller fixes the first and resubmits, so the thrown
 * error's payload also names it as `alsoViolates`, and the caller can act on
 * both in one round trip instead of discovering the second on a retry.
 *
 * Pure — no DB — so both rules are unit-tested with no database (CLAUDE.md's
 * first test tier); the route supplies the current row and turns the thrown
 * `ApiError` into the 409 response.
 */
export function resolveProjectPartUpdate(
  current: {
    fromStockQty: number;
    missingQty: number;
    orderedQty: number;
    receivedQty: number;
    preparedQty: number;
  },
  patch: { fromStockQty?: number; missingQty?: number },
): ResolvedProjectPartQty {
  const fromStockQty = patch.fromStockQty ?? current.fromStockQty;
  const missingQty = patch.missingQty ?? current.missingQty;
  const missingBelowOrdered = missingQty < current.orderedQty;
  const fromStockBelowPrepared = fromStockQty + current.receivedQty < current.preparedQty;

  if (missingBelowOrdered) {
    throw new ApiError(
      409,
      ErrorCodes.MISSING_QTY_BELOW_ORDERED,
      fromStockBelowPrepared
        ? { alsoViolates: ErrorCodes.FROM_STOCK_QTY_BELOW_PREPARED }
        : undefined,
    );
  }
  if (fromStockBelowPrepared) {
    throw new ApiError(409, ErrorCodes.FROM_STOCK_QTY_BELOW_PREPARED);
  }
  return { fromStockQty, missingQty };
}

/** `POST /:id/parts/recalculate`'s result (§5.2): `changed` is every row
 *  actually rewritten, `skipped` is every row the recalculate deliberately
 *  left alone because the user has typed over it. A row that is eligible but
 *  whose recomputed numbers happen to match what's already stored is
 *  neither — there is nothing to explain about it. */
export interface ReseedResult {
  changed: ProjectPartRow[];
  skipped: ProjectPartRow[];
  /** `before` values for each row in `changed`, same order and length. Not
   *  needed to render the confirm dialog — only so the caller can log the
   *  recalculate to the audit trail (§5.6) the same way a manual PATCH does:
   *  a recalculate can move the same purchasing-dispute field, just without
   *  anyone typing over it. */
  changedFrom: { fromStockQty: number; missingQty: number }[];
}

interface ReseedCandidate {
  id: number;
  partId: number;
  requiredQty: number;
  fromStockQty: number;
  missingQty: number;
  missingQtyOverridden: boolean;
  orderedQty: number;
  receivedQty: number;
  preparedQty: number;
}

/**
 * `POST /:id/parts/recalculate`, backed by §5.3's re-seed. Recomputes free
 * stock and rewrites `from_stock_qty` / `missing_qty` for every row that is
 * **not** overridden, via `seedFromFreeStock` floored at `ordered_qty` so a
 * recalculate can never undo an order that already exists. Rows the user has
 * typed over are left exactly as they are — that is what the flag exists for
 * (§3.3) — and come back as `skipped` so the confirm dialog (§6.4) can say
 * "N will change, M are skipped as overridden" before the user commits.
 *
 * Must run inside the caller's transaction: the row lock taken up front makes
 * the read-recompute-write atomic against a concurrent PATCH or a second
 * recalculate racing it.
 */
export async function reseedFromStock(
  client: PoolClient,
  projectId: number,
): Promise<ReseedResult> {
  // Owns this precondition rather than trusting the caller to have checked it
  // (the way `freezeProjectBom` owns PROJECT_HAS_NO_PARTS): a draft has never
  // been frozen, and a stopped or completed project's rows are a closed
  // record that a re-seed must not silently rewrite with live stock data.
  const projectResult = await client.query<{ status: ProjectStatus }>(
    `SELECT status FROM projects WHERE id = $1`,
    [projectId],
  );
  if (projectResult.rows[0]?.status !== 'started') {
    throw new ApiError(409, ErrorCodes.PROJECT_PARTS_NOT_FROZEN);
  }

  // Guaranteed non-empty now: freezeProjectBom refuses to leave a started
  // project with an empty BOM, so a started project always has rows here.
  const current = await client.query<ReseedCandidate>(
    `SELECT id, part_id AS "partId", required_qty AS "requiredQty",
       from_stock_qty AS "fromStockQty", missing_qty AS "missingQty",
       missing_qty_overridden AS "missingQtyOverridden", ordered_qty AS "orderedQty",
       received_qty AS "receivedQty", prepared_qty AS "preparedQty"
     FROM project_parts
     WHERE project_id = $1
     FOR UPDATE`,
    [projectId],
  );

  const eligible = current.rows.filter((row) => !row.missingQtyOverridden);
  const overriddenIds = new Set(
    current.rows.filter((row) => row.missingQtyOverridden).map((row) => row.id),
  );

  const stock = await getPartStock(
    client,
    eligible.map((row) => row.partId),
    projectId,
  );

  // Keyed by id rather than a plain Set: membership IS "this row changed",
  // and the value is the one thing `changed` (built from the post-update
  // read below) can no longer tell you — what it changed from.
  const beforeByChangedId = new Map<number, { fromStockQty: number; missingQty: number }>();
  const toWrite: { id: number; fromStockQty: number; missingQty: number }[] = [];
  for (const row of eligible) {
    const free = stock.get(row.partId)?.free ?? 0;
    // Floors from_stock_qty at what's already been prepared, net of what's
    // been received (§ resolveProjectPartUpdate) — the same
    // chk_project_parts_prepared_within_pickable a manual PATCH must respect,
    // so a re-seed racing ahead of Preparation can't trip it either.
    const minFromStockQty = Math.max(0, row.preparedQty - row.receivedQty);
    const { fromStockQty, missingQty } = seedFromFreeStock(
      row.requiredQty,
      free,
      row.orderedQty,
      minFromStockQty,
    );
    if (fromStockQty !== row.fromStockQty || missingQty !== row.missingQty) {
      toWrite.push({ id: row.id, fromStockQty, missingQty });
      beforeByChangedId.set(row.id, { fromStockQty: row.fromStockQty, missingQty: row.missingQty });
    }
  }

  if (toWrite.length > 0) {
    // One UPDATE for both columns (§3.3 "WRITE ORDER MATTERS" — the CHECKs
    // run per statement, not deferred), and one round trip for every changed
    // row rather than one per part.
    await client.query(
      `UPDATE project_parts AS pp
       SET from_stock_qty = u.from_stock_qty, missing_qty = u.missing_qty, updated_at = NOW()
       FROM unnest($1::int[], $2::int[], $3::int[]) AS u(id, from_stock_qty, missing_qty)
       WHERE pp.id = u.id`,
      [
        toWrite.map((u) => u.id),
        toWrite.map((u) => u.fromStockQty),
        toWrite.map((u) => u.missingQty),
      ],
    );
  }

  const rows = toProjectPartRows(await loadFrozenProjectBom(client, projectId), 'started');
  const changed: ProjectPartRow[] = [];
  const changedFrom: { fromStockQty: number; missingQty: number }[] = [];
  const skipped: ProjectPartRow[] = [];
  for (const row of rows) {
    if (row.id === null) continue;
    const before = beforeByChangedId.get(row.id);
    if (before) {
      changed.push(row);
      changedFrom.push(before);
    } else if (overriddenIds.has(row.id)) {
      skipped.push(row);
    }
  }
  return { changed, skipped, changedFrom };
}
