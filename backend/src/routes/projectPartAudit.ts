// Shared by the PATCH and recalculate routes below (§5.6): both log the same
// kind of change to a project's audit trail — one event per part whose
// sourcing quantities moved. Pulled out on its own, rather than left as a
// `.map` inline in each route, so the actual from/to mapping — the exact
// place a swapped field or a mis-indexed lookup would go unnoticed — is
// unit-tested with no database (CLAUDE.md's first test tier), instead of
// living only inside an Express handler nothing in this test suite imports.
import type { AuditEvent } from '../services/audit.js';

/** One part's before/after sourcing quantities, in the shape both routes
 *  have on hand when they call this — a manual PATCH resolves one row, a
 *  recalculate pairs `reseedFromStock`'s `changed` with its `changedFrom`. */
export interface ProjectPartQtyChange {
  partName: string;
  before: { fromStockQty: number; missingQty: number };
  after: { fromStockQty: number; missingQty: number };
}

/** One line for the audit log's from/to: both sourcing columns together,
 *  since a single change can move either or both. */
function projectPartQtyLabel(fromStockQty: number, missingQty: number): string {
  return `From stock ${fromStockQty} · Missing ${missingQty}`;
}

/** One audit event per change, same order as given. */
export function buildProjectPartQtyEvents(changes: ProjectPartQtyChange[]): AuditEvent[] {
  return changes.map(({ partName, before, after }) => ({
    type: 'part',
    tag: 'changed',
    label: partName,
    from: projectPartQtyLabel(before.fromStockQty, before.missingQty),
    to: projectPartQtyLabel(after.fromStockQty, after.missingQty),
  }));
}
