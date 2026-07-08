import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import type {
  DetailSubProduct,
  ProductDetail,
  SubProductRevision,
} from '../../../../types/products.ts';
import type { ComposeSelection, Selection } from '../types.ts';

/**
 * Owns everything related to "what's currently active/selected" on the
 * product detail page: the radio-style product revision switch, the left
 * tree's selection, Revisions mode, and the in-progress "compose a new
 * revision" flow. Kept separate from data loading (documents/BOM/parts) so
 * each concern can be reasoned about on its own.
 */
export function useRevisionSelection(detail: ComputedRef<ProductDetail | null>) {
  const activeProductRevId = ref<number | null>(null);
  const selection = ref<Selection>({ type: 'product' });
  const revisionsMode = ref(false);
  // True while the user is actively building a new product revision
  // composition (started via "Add new revision" on the left tree). Gates
  // whether the compose checkboxes are interactive and whether the "Save as
  // a new revision" button is shown.
  const composingRevision = ref(false);
  const composeSelection = ref<ComposeSelection>({});

  // productRevisionId -> Set<subProductRevisionId>
  const membershipMap = computed<Map<number, Set<number>>>(() => {
    const map = new Map<number, Set<number>>();
    for (const m of detail.value?.membership ?? []) {
      let set = map.get(m.productRevisionId);
      if (!set) {
        set = new Set();
        map.set(m.productRevisionId, set);
      }
      set.add(m.subProductRevisionId);
    }
    return map;
  });

  function linkedRevOf(
    sp: DetailSubProduct,
    productRevId: number | null,
  ): SubProductRevision | null {
    if (productRevId == null) return null;
    const set = membershipMap.value.get(productRevId);
    if (!set) return null;
    // Defensive: if several revisions of one sub-product are linked to the
    // same product revision (legacy data), use the highest revision number.
    const matches = sp.revisions.filter((r) => set.has(r.id));
    if (matches.length === 0) return null;
    return matches.reduce((a, b) => (b.revisionNumber > a.revisionNumber ? b : a));
  }

  function revisionLabel(revId: number | null | undefined): string {
    if (revId == null) return '—';
    return detail.value?.revisions.find((r) => r.id === revId)?.label ?? '—';
  }

  const defaultRevisionLabel = computed(() =>
    revisionLabel(detail.value?.defaultRevisionId ?? null),
  );

  function setActiveRevision(id: number) {
    if (id === activeProductRevId.value || !detail.value) return;
    // In normal mode, keep the same sub-product selected if it has a linked
    // revision in the new product revision; otherwise fall back to the product.
    const sel = selection.value;
    if (!revisionsMode.value && sel.type === 'subProduct') {
      const sp = detail.value.subProducts.find((s) => s.id === sel.spId);
      const linked = sp ? linkedRevOf(sp, id) : null;
      selection.value = linked
        ? { type: 'subProduct', spId: sel.spId, spRevId: linked.id }
        : { type: 'product' };
    }
    activeProductRevId.value = id;
  }

  function onSelect(sel: Selection) {
    selection.value = sel;
  }

  function toggleRevisionsMode() {
    revisionsMode.value = !revisionsMode.value;
    composingRevision.value = false;
    composeSelection.value = {};
  }

  // Remembers which product revision was active before composing started, so
  // Cancel can restore it exactly.
  const preComposeRevId = ref<number | null>(null);

  // Start composing a brand-new product revision: clear every compose
  // checkbox, deselect any active product revision (top bar and tree chips),
  // and switch the tree into an interactive/composing state.
  function startNewRevision() {
    preComposeRevId.value = activeProductRevId.value;
    composeSelection.value = {};
    activeProductRevId.value = null;
    if (selection.value.type === 'subProduct') selection.value = { type: 'product' };
    composingRevision.value = true;
  }

  // Cancel composing: drop the in-progress selection and restore whichever
  // product revision was active beforehand.
  function cancelNewRevision() {
    composingRevision.value = false;
    composeSelection.value = {};
    activeProductRevId.value = preComposeRevId.value;
  }

  function toggleCompose(spId: number, revId: number) {
    if (!composingRevision.value) return;
    const next = { ...composeSelection.value };
    if (next[spId] === revId) delete next[spId];
    else next[spId] = revId;
    composeSelection.value = next;
  }

  // Drop a revision from any in-progress composition (e.g. after it — or its
  // whole sub-product — was deleted elsewhere).
  function dropFromComposition(spId: number, revId?: number) {
    if (!composingRevision.value) return;
    if (composeSelection.value[spId] == null) return;
    if (revId != null && composeSelection.value[spId] !== revId) return;
    const next = { ...composeSelection.value };
    delete next[spId];
    composeSelection.value = next;
  }

  function spRevInfo(spId: number, revId: number) {
    const sp = detail.value?.subProducts.find((s) => s.id === spId);
    const rev = sp?.revisions.find((r) => r.id === revId);
    return { sp, rev };
  }

  /** After (re)loading the product detail: pick the default/latest revision
   *  and reset the selection to the product itself. */
  function applyDefaults() {
    const d = detail.value;
    if (!d || d.revisions.length === 0) return;
    const latest = d.revisions.reduce((a, b) => (b.revisionNumber > a.revisionNumber ? b : a));
    const initial =
      d.defaultRevisionId != null && d.revisions.some((r) => r.id === d.defaultRevisionId)
        ? d.defaultRevisionId
        : latest.id;
    activeProductRevId.value = initial;
    selection.value = { type: 'product' };
  }

  /** Navigating to a different product: reset everything back to defaults. */
  function resetForProductChange() {
    activeProductRevId.value = null;
    selection.value = { type: 'product' };
    revisionsMode.value = false;
    composingRevision.value = false;
    composeSelection.value = {};
  }

  return {
    activeProductRevId,
    selection,
    revisionsMode,
    composingRevision,
    composeSelection,
    membershipMap,
    revisionLabel,
    defaultRevisionLabel,
    setActiveRevision,
    onSelect,
    toggleRevisionsMode,
    startNewRevision,
    cancelNewRevision,
    toggleCompose,
    dropFromComposition,
    spRevInfo,
    applyDefaults,
    resetForProductChange,
  };
}
