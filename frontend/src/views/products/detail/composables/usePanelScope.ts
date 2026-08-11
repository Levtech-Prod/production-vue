import { computed } from 'vue';
import type { Ref } from 'vue';
import type { PanelScope, Selection } from '../types.ts';

/**
 * What the Documents / BOM panels are currently scoped to, derived from the
 * left tree's selection (a sub-product revision) or, absent that, the active
 * product revision. Shared by the documents and BOM/parts composables so
 * they always agree on "what am I looking at right now".
 */
export function usePanelScope(
  selection: Ref<Selection>,
  activeProductRevId: Ref<number | null>,
  productId: Ref<number | null>,
) {
  const panelScope = computed<PanelScope | null>(() => {
    const sel = selection.value;
    if (sel.type === 'subProduct') return { kind: 'spRev', spId: sel.spId, revId: sel.spRevId };
    return activeProductRevId.value != null && productId.value != null
      ? { kind: 'product', productId: productId.value, revId: activeProductRevId.value }
      : null;
  });

  // One cache entry per revision on both sides. Product documents are stored
  // per product REVISION now (document-system-plan.md §3.3), so Rev.1 and
  // Rev.2 must not share a single 'product' bucket.
  function docsKeyFor(scope: PanelScope): string {
    return scope.kind === 'product'
      ? `prod:${scope.revId}`
      : `sp:${scope.spId}:${scope.revId}`;
  }

  return { panelScope, docsKeyFor };
}
