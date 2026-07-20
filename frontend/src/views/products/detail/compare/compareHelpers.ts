// Pure, framework-free helpers shared by the Compare panel's rows and
// components. Kept dependency-free (no `ref`/`computed`) so they're easy to
// unit test and reuse from any component without wiring up reactivity.

import type { CompareStatus, ComparePartRow, ComparePartSide } from '../../../../types/products.ts';

// ── Layout ────────────────────────────────────────────────────────────────
// Grid-template-column strings shared by every compare table. Centralised
// here (instead of repeated Tailwind arbitrary-value classes) so the header
// row and the data rows for both tables always stay pixel-aligned, and so a
// column width only ever needs to change in one place.

/** image | name+sku | linked revision */
export const PRODUCT_SIDE_GRID = '32px minmax(0,1fr) minmax(0,1fr)';
/** image | name+code | quantity | params */
export const PART_SIDE_GRID = '32px minmax(0,2fr) minmax(0,1fr) minmax(0,3fr)';

const OUTER_GRID_SINGLE = 'minmax(0,1fr)';
const OUTER_GRID_DUAL = 'minmax(0,1fr) 34px minmax(0,1fr)';

/** The outer 3-column (side A / status / side B) row template, collapsing
 *  to a single column when there's nothing to compare against. */
export function outerGrid(isSingle: boolean): string {
  return isSingle ? OUTER_GRID_SINGLE : OUTER_GRID_DUAL;
}

// ── Status ordering & display ───────────────────────────────────────────────

/** Sort order shared by both scopes: identical rows first, then rows changed
 *  in both revisions, then rows only present in one revision (added/removed). */
export function statusRank(status: CompareStatus | null): number {
  switch (status) {
    case 'unchanged':
      return 0;
    case 'changed':
      return 1;
    case 'added':
    case 'removed':
      return 2;
    default:
      return 0; // single mode — nothing to diff, order doesn't matter
  }
}

/** Background for a single side's block: neutral when identical (or single
 *  mode, nothing to diff), a light red wash when the two sides differ. The
 *  status column between the two sides is left unstyled, so red only marks
 *  the two side blocks themselves — not the gap between them. */
export function sideAccentClass(same: boolean | null): string {
  return same === false ? 'bg-red-50/40' : '';
}

/** Sign shown inside the small status dot next to a differing row. */
export function statusSign(status: CompareStatus | null): string {
  if (!status) return '';
  return { added: '+', removed: '−', changed: '~', unchanged: '' }[status] ?? '';
}

// ── Part-row helpers ─────────────────────────────────────────────────────

export function hasDetails(row: ComparePartRow): boolean {
  return (
    !!row.categoryName ||
    (row.pricePerPiece != null && row.pricePerPiece !== '') ||
    (row.parameters?.length ?? 0) > 0
  );
}

export function sideQty(side: ComparePartSide | null): string {
  if (!side) return '—';
  return `${side.quantity}${side.unit ? ` ${side.unit}` : ''}`;
}

/** Quantity delta shown on side B (e.g. "+2"); empty when there's nothing
 *  to diff against (single mode, or the row is only present on one side). */
export function qtyDelta(row: ComparePartRow, isSingle: boolean): string {
  if (isSingle || !row.inA || !row.inB) return '';
  const d = Number(row.inB.quantity) - Number(row.inA.quantity);
  if (Number.isNaN(d) || d === 0) return '';
  return d > 0 ? `+${d}` : `${d}`;
}

/** Whether a part row is identical across A/B (null in single mode, nothing to diff). */
export function partSame(row: ComparePartRow, isSingle: boolean): boolean | null {
  return isSingle ? null : row.status === 'unchanged';
}
