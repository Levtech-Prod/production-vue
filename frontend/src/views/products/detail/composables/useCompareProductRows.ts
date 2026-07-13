import { computed } from 'vue';
import type { CompareStatus, ProductDetail } from '../../../../types/products.ts';
import { statusRank } from '../compareHelpers.ts';
import type { CompareProductRow } from '../types.ts';
import type { CompareRevisionSelection } from './useCompareRevisionSelection.ts';

/**
 * Builds the "product revisions" table rows entirely client-side from the
 * membership list already present in `detail` — unlike part comparisons,
 * there's no server round-trip here.
 */
export function useCompareProductRows(
  props: { detail: ProductDetail },
  selection: Pick<CompareRevisionSelection, 'scope' | 'aId' | 'bId' | 'jumpTo'>,
) {
  const membershipMap = computed<Map<number, Set<number>>>(() => {
    const map = new Map<number, Set<number>>();
    for (const m of props.detail.membership) {
      let set = map.get(m.productRevisionId);
      if (!set) {
        set = new Set();
        map.set(m.productRevisionId, set);
      }
      set.add(m.subProductRevisionId);
    }
    return map;
  });

  const productRows = computed<CompareProductRow[] | null>(() => {
    const { scope, aId, bId } = selection;
    if (scope.value !== 'product' || aId.value == null) return null;

    const setA = membershipMap.value.get(aId.value) ?? new Set<number>();
    const setB =
      bId.value != null ? (membershipMap.value.get(bId.value) ?? new Set<number>()) : null;

    const rows: CompareProductRow[] = [];
    for (const sp of props.detail.subProducts) {
      const revA = sp.revisions.find((r) => setA.has(r.id)) ?? null;
      const revB = setB ? (sp.revisions.find((r) => setB.has(r.id)) ?? null) : null;

      if (!setB) {
        // Single mode: only what's in A.
        if (revA) {
          rows.push({
            spId: sp.id,
            name: sp.name,
            sku: sp.sku,
            image: sp.image ?? null,
            revA,
            revB: null,
            status: null,
            same: null,
          });
        }
        continue;
      }

      if (!revA && !revB) continue;
      const status: CompareStatus =
        revA && revB
          ? revA.id === revB.id
            ? 'unchanged'
            : 'changed'
          : revA
            ? 'removed'
            : 'added';
      rows.push({
        spId: sp.id,
        name: sp.name,
        sku: sp.sku,
        image: sp.image ?? null,
        revA,
        revB,
        status,
        same: status === 'unchanged',
      });
    }

    // Identical first, then changed-in-both, then only-in-one-side last.
    return rows.sort((a, b) => statusRank(a.status) - statusRank(b.status));
  });

  function drillIntoParts(row: CompareProductRow) {
    if (!row.revA || !row.revB) return;
    selection.jumpTo({ scope: row.spId, aId: row.revA.id, bId: row.revB.id });
  }

  return { productRows, drillIntoParts };
}
