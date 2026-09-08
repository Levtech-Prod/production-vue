// ===========================================================================
// Project BOM — the flattened parts list of a project.
// (projects-preparation-plan.md §3.4, §5.3, §5.4.)
// ---------------------------------------------------------------------------
// A project's parts list exists in two forms, and this file is the one place
// that knows both:
//
//   draft    — nothing is stored. `computeProjectBom` runs §3.4's aggregation
//              against each product's PINNED revision and returns the rows in
//              memory, so a salesman sees what a job needs, and what will have
//              to be bought, before committing to it (§5.3). It writes nothing.
//   started  — the same rows, frozen at Start into `project_parts` /
//              `project_part_usages`, read back by `loadFrozenProjectBom`.
//
// Both readers answer with the SAME `ProjectBomPart` shape, and
// `toProjectPartRows` turns either into the one payload §5.4 specifies. That
// is deliberate: the collapse of usage rows to distinct products, and the
// derived to-buy / on-order / to-pick figures, are one decision each and are
// therefore written once, not once per branch. The frontend then differs only
// in showing a draft notice.
//
// Three levels of quantity, per §3.4:
//   1. one usage  — (product-in-the-project, sub-product revision, part)
//   2. per product — SUM of level 1 over that product's usages, x its quantity
//   3. per project — SUM of level 2; this is `required_qty`
// Level 2 is never stored, here or in the database: it is a regrouping of
// level 1 that nothing else depends on.
//
// `product-revisions/:revId/bom` was checked first and does not fit: it
// flattens ONE revision, nested by sub-product, with no project quantities and
// no stock — a different grain answering a different question (what is in this
// revision, not what does this job need).
// ===========================================================================
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

/** Scale of every quantity column (`NUMERIC(12,3)`). */
const QTY_SCALE = 3;

/** Sums of those quantities done in JS pick up binary-float dust
 *  (0.1 + 0.2 = 0.30000000000000004). The columns cannot hold it and the
 *  table must not show it, so every derived quantity is rounded back to the
 *  scale the database stores. */
function qty(value: number): number {
  return Number(value.toFixed(QTY_SCALE));
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
  qtyPerUnit: string;
  productQuantity: number;
}

// §3.4's `usage` CTE — one row per (product-in-the-project, sub-product
// revision, part) — with the columns the Parts table displays joined on. No
// GROUP BY: `sub_product_revision_parts` is unique on (revision, part) and
// `product_revision_sub_products` on (product revision, sub-product revision),
// so every row here is already a distinct usage site.
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
  requiredQty: string;
  fromStockQty: string;
  missingQty: string;
  missingQtyOverridden: boolean;
  orderedQty: string;
  receivedQty: string;
  preparedQty: string;
}

interface FrozenUsageRow {
  projectPartId: number;
  projectProductId: number;
  productId: number;
  sku: string;
  revisionLabel: string;
  subProductRevisionId: number;
  qtyPerUnit: string;
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
      qtyPerUnit: Number(row.qtyPerUnit),
      productQuantity: row.productQuantity,
    });
  }
  return byPart;
}

/** Level 3: what the whole project needs of a part. */
function requiredFrom(usages: ProjectBomUsage[]): number {
  return qty(usages.reduce((sum, u) => sum + u.qtyPerUnit * u.productQuantity, 0));
}

/**
 * The project's parts list computed live from the pinned revisions, with
 * `fromStockQty` / `missingQty` seeded from today's free stock and the
 * progress buckets at zero (§5.3). Writes nothing: this is what a draft's
 * Parts table serves, and what Start re-runs inside its transaction rather
 * than trusting numbers the browser sends back.
 */
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
    // §5.3's seed, MIN(required, MAX(0, free)) — clamped at zero from below as
    // well, because a BOM line with quantity <= 0 is still representable
    // (§11.5) and must read as nothing to claim rather than a negative one.
    // `requiredQty` itself is left exactly as computed: the CHECK on
    // `project_parts.required_qty` is what refuses such a project at Start,
    // and rounding it up here would hide the reason.
    const fromStockQty = qty(Math.max(0, Math.min(requiredQty, Math.max(0, partStock.free))));
    return {
      id: null,
      part,
      requiredQty,
      fromStockQty,
      missingQty: qty(Math.max(0, requiredQty - fromStockQty)),
      missingQtyOverridden: false,
      orderedQty: 0,
      receivedQty: 0,
      preparedQty: 0,
      stock: partStock,
      usages,
    };
  });
}

/**
 * The project's frozen parts list, as stored at Start. Quantities come from
 * `project_parts`; `available` / `reserved` are read live, because stock moves
 * after a project starts and the table's job is to show that it has.
 */
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
      qtyPerUnit: Number(row.qtyPerUnit),
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
    requiredQty: Number(row.requiredQty),
    fromStockQty: Number(row.fromStockQty),
    missingQty: Number(row.missingQty),
    missingQtyOverridden: row.missingQtyOverridden,
    orderedQty: Number(row.orderedQty),
    receivedQty: Number(row.receivedQty),
    preparedQty: Number(row.preparedQty),
    stock: stock.get(row.partId) ?? { available: 0, reserved: 0, free: 0 },
    usages: usagesByPart.get(row.id) ?? [],
  }));
}

/** Level 2: the usage rows collapsed to distinct products, in first-seen
 *  order. A part used in three sub-products of one product yields one entry
 *  whose `qtyPerUnit` is the sum of the three, so the `qtyForProduct` values
 *  always sum back to `requiredQty`. */
function collapseToProducts(usages: ProjectBomUsage[]): ProjectPartRow['products'] {
  const byProduct = new Map<number, ProjectPartRow['products'][number]>();
  for (const usage of usages) {
    const existing = byProduct.get(usage.projectProductId);
    if (existing) {
      existing.qtyPerUnit = qty(existing.qtyPerUnit + usage.qtyPerUnit);
      existing.qtyForProduct = qty(existing.qtyPerUnit * usage.productQuantity);
      continue;
    }
    byProduct.set(usage.projectProductId, {
      projectProductId: usage.projectProductId,
      productId: usage.productId,
      sku: usage.sku,
      revisionLabel: usage.revisionLabel,
      qtyPerUnit: qty(usage.qtyPerUnit),
      qtyForProduct: qty(usage.qtyPerUnit * usage.productQuantity),
    });
  }
  return [...byProduct.values()];
}

/**
 * The Parts table payload (§5.4), from either form of the BOM. The three
 * derived quantities are computed here rather than in the browser so the
 * table and the board cannot come to disagree about what a row still owes.
 */
export function toProjectPartRows(
  parts: ProjectBomPart[],
  status: ProjectStatus,
): ProjectPartRow[] {
  // Stopping releases a project's claim by dropping it out of §4.2's
  // `reserved` — the status filter is the whole mechanism, no stock is
  // written — so a stopped or completed project's sourcing numbers are a
  // record of what it once claimed, and warning that stock is short for a
  // claim nobody counts any more would be warning about nothing. A draft's
  // claim is prospective and still flags: "the stock this quote counts on is
  // already spoken for" is exactly what a salesman needs before starting.
  const claimIsCounted = status === 'draft' || status === 'started';
  return parts.map((row) => {
    // What this project itself still has an outstanding claim on — the same
    // expression §4.2 sums over OTHER started projects to get `reserved`, so
    // the shortfall test below compares like with like.
    const toPickQty = qty(row.fromStockQty + row.receivedQty - row.preparedQty);
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
      toBuyQty: qty(row.missingQty - row.orderedQty),
      onOrderQty: qty(row.orderedQty - row.receivedQty),
      toPickQty,
      stockShortfall: claimIsCounted && row.stock.available < row.stock.reserved + toPickQty,
    };
  });
}
