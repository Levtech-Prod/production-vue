import { computed } from 'vue';
import type { Ref } from 'vue';
import type { PanelScope, Selection } from '../types.ts';

/**
 * What the Documents / BOM panels are currently scoped to, derived from the
 * left tree's selection (a sub-product revision) or, absent that, the active
 * product revision. Shared by the documents and BOM/parts composables so
 * they always agree on "what am I looking at right now".
 */
export function usePanelScope(selection: Ref<Selection>, activeProductRevId: Ref<number | null>) {
  const panelScope = computed<PanelScope | null>(() => {
    const sel = selection.value;
    if (sel.type === 'subProduct') return { kind: 'spRev', spId: sel.spId, revId: sel.spRevId };
    return activeProductRevId.value != null
      ? { kind: 'product', revId: activeProductRevId.value }
      : null;
  });

  // Product documents are product-level (not revision-scoped) — one cache entry.
  function docsKeyFor(scope: PanelScope): string {
    return scope.kind === 'product' ? 'product' : `sp:${scope.spId}:${scope.revId}`;
  }

  return { panelScope, docsKeyFor };
}
