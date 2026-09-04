// ===========================================================================
// Stock numbers for the Parts table and for freezing/re-seeding a project's
// BOM. (projects-preparation-plan.md §4.2; deviations explained in §11.8.)
// ---------------------------------------------------------------------------
// "Available" is the existing FIFO rule, unchanged from availableOf /
// summarizeStock in frontend/src/utils/stock.ts — just summed in SQL instead
// of over fetched rows: SUM(quantity - quantity_consumed) across 'received'
// stock_entries. Migration 024 adds a CHECK that keeps this SUM equivalent to
// the frontend's per-row-clamped version: it makes quantity_consumed >
// quantity (the only case where "sum then floor" and "floor then sum" would
// disagree) impossible at the database level, not just unlikely in practice.
//
// "Reserved" is what OTHER started projects have claimed but not yet picked:
// SUM(from_stock_qty + received_qty - prepared_qty) over their project_parts
// rows. There is deliberately no reservations table to release when a
// project stops — filtering on projects.status = 'started' means a stopped
// project's claim simply stops being summed (§4.2).
//
// getAvailableQuantities and getReservedQuantities each take the whole batch
// of part ids in one ANY($1) round trip — never one query per part. getPartStock
// (the one callers actually want available+reserved+free from) runs both as
// CTEs inside a SINGLE statement instead of two separate round trips: the two
// numbers are then guaranteed to come from the same database snapshot, which
// two independent queries (even awaited together via Promise.all) would not
// guarantee against a concurrent write landing between them. This is stronger
// than what §4.2 literally describes (two separate queries) but composes the
// exact same predicates — see §11.8 for why.
// ===========================================================================
import type { Queryable } from '../db.js';

export interface PartStock {
  available: number;
  reserved: number;
  /** available - reserved, unclamped. Can be negative: other started
   *  projects have already claimed more than physically exists — the stale
   *  claim §4.2 says to surface rather than silently reconcile. */
  free: number;
}

const AVAILABLE_SELECT = `
  SELECT part_id, SUM(quantity - quantity_consumed) AS available
  FROM stock_entries
  WHERE type = 'received' AND part_id = ANY($1::int[])
  GROUP BY part_id
`;

const RESERVED_SELECT = `
  SELECT pp.part_id,
         SUM(pp.from_stock_qty + pp.received_qty - pp.prepared_qty) AS reserved
  FROM project_parts pp
  JOIN projects pr ON pr.id = pp.project_id
  WHERE pp.part_id = ANY($1::int[])
    AND pp.project_id <> $2
    AND pp.prepared_qty < pp.from_stock_qty + pp.received_qty
    AND pr.status = 'started'
  GROUP BY pp.part_id
`;

/** Available quantity per part id: the FIFO remainder on received stock. */
export async function getAvailableQuantities(
  db: Queryable,
  partIds: number[],
): Promise<Map<number, number>> {
  if (partIds.length === 0) return new Map();
  const result = await db.query<{ part_id: number; available: string }>(AVAILABLE_SELECT, [
    partIds,
  ]);
  return new Map(result.rows.map((r) => [r.part_id, Number(r.available)]));
}

/**
 * Quantity per part id claimed by OTHER started projects — an outstanding
 * pick against physical stock that must not be promised twice. Received
 * goods count too: they are sitting in stock earmarked for that project.
 * `excludeProjectId` is the project asking, so its own rows are never a
 * competing claim against itself.
 */
export async function getReservedQuantities(
  db: Queryable,
  partIds: number[],
  excludeProjectId: number,
): Promise<Map<number, number>> {
  if (partIds.length === 0) return new Map();
  const result = await db.query<{ part_id: number; reserved: string }>(RESERVED_SELECT, [
    partIds,
    excludeProjectId,
  ]);
  return new Map(result.rows.map((r) => [r.part_id, Number(r.reserved)]));
}

/**
 * Available, reserved, and free (available - reserved) stock per part id —
 * everything the Parts table and the freeze/re-seed step need, for one batch
 * of part ids, read from one consistent snapshot in one round trip. A part
 * id with no matching rows in either comes back as zero, not missing, so
 * callers can index the map directly.
 */
export async function getPartStock(
  db: Queryable,
  partIds: number[],
  excludeProjectId: number,
): Promise<Map<number, PartStock>> {
  if (partIds.length === 0) return new Map();
  const result = await db.query<{ part_id: number; available: string; reserved: string }>(
    `WITH available AS (${AVAILABLE_SELECT}),
          reserved AS (${RESERVED_SELECT})
     SELECT ids.part_id,
            COALESCE(available.available, 0) AS available,
            COALESCE(reserved.reserved, 0) AS reserved
     FROM unnest($1::int[]) AS ids(part_id)
     LEFT JOIN available ON available.part_id = ids.part_id
     LEFT JOIN reserved ON reserved.part_id = ids.part_id`,
    [partIds, excludeProjectId],
  );
  const byPart = new Map<number, PartStock>();
  for (const r of result.rows) {
    const available = Number(r.available);
    const reserved = Number(r.reserved);
    byPart.set(r.part_id, { available, reserved, free: available - reserved });
  }
  return byPart;
}
