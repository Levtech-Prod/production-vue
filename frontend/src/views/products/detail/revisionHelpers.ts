import type { DetailSubProduct, SubProductRevision } from '../../../types/products.ts';
import type { CompositionChange, ComposeSelection } from './types.ts';

/** Newest revision first. Copies — the source array stays in API order. */
export function newestFirst<T extends { revisionNumber: number }>(
  revisions: readonly T[],
): T[] {
  return [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
}

/**
 * Display order for the timeline and the header pills: the default revision is
 * pinned first (it is the one the product actually ships), the rest follow in
 * the requested order. Pinning wins over the sort in both directions — a pin
 * that moved when you flipped the sort would not be a pin.
 */
export function pinnedOrder<T extends { id: number; revisionNumber: number }>(
  revisions: readonly T[],
  defaultRevisionId: number | null | undefined,
  newest = true,
): T[] {
  const ordered = newestFirst(revisions);
  if (!newest) ordered.reverse();
  const at = ordered.findIndex((r) => r.id === defaultRevisionId);
  if (at > 0) ordered.unshift(...ordered.splice(at, 1));
  return ordered;
}

/**
 * The sub-product revision linked to `productRevId`, or null. Defensive: if
 * legacy data links several revisions of one sub-product to the same product
 * revision, the highest revision number wins.
 */
export function linkedRevOf(
  sp: DetailSubProduct,
  membershipMap: Map<number, Set<number>>,
  productRevId: number | null,
): SubProductRevision | null {
  if (productRevId == null) return null;
  const set = membershipMap.get(productRevId);
  if (!set) return null;
  const matches = sp.revisions.filter((r) => set.has(r.id));
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.revisionNumber > a.revisionNumber ? b : a));
}

/**
 * What changed between two compositions, one entry per affected sub-product.
 * Labels rather than ids: the only consumer is the "save these changes?"
 * summary, which names revisions the way the tree does.
 */
export function diffComposition(
  subProducts: readonly DetailSubProduct[],
  before: ComposeSelection,
  after: ComposeSelection,
): CompositionChange[] {
  const changes: CompositionChange[] = [];
  for (const sp of subProducts) {
    const was = before[sp.id];
    const now = after[sp.id];
    if (was === now) continue;
    const labelOf = (revId: number | undefined) =>
      sp.revisions.find((r) => r.id === revId)?.label ?? '—';
    if (was == null) {
      changes.push({ spId: sp.id, name: sp.name, kind: 'added', from: null, to: labelOf(now) });
    } else if (now == null) {
      changes.push({ spId: sp.id, name: sp.name, kind: 'removed', from: labelOf(was), to: null });
    } else {
      changes.push({
        spId: sp.id,
        name: sp.name,
        kind: 'changed',
        from: labelOf(was),
        to: labelOf(now),
      });
    }
  }
  return changes;
}
