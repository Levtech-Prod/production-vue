import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import type {
  DetailSubProduct,
  ProductDetail,
  SubProductRevision,
} from '../../../../types/products.ts';
import { linkedRevOf as resolveLinkedRev } from '../revisionHelpers.ts';
import type { ComposeSelection, RevPanelView, Selection } from '../types.ts';

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
  // Which of Revisions mode's two views is showing. Ignored while
  // `revisionsMode` is off — normal mode has a single view. Composition is
  // the default: it holds the revision chips, the per-sub-product revision
  // lists and the compose checkboxes, so it is the view you actually work in.
  // The changelog is for looking back, and is one click away.
  const revPanelView = ref<RevPanelView>('composition');
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
    return resolveLinkedRev(sp, membershipMap.value, productRevId);
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
    // Always land on composition, never on whichever view was left open last
    // time: switching into Revisions mode is how you go to compose or inspect
    // a revision's make-up, so that is the view worth arriving in.
    if (revisionsMode.value) revPanelView.value = 'composition';
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
    // Composing happens in the composition view — that's where the checkboxes
    // and the per-sub-product revision list live.
    revPanelView.value = 'composition';
    composingRevision.value = true;
  }

  // Cancel composing: drop the in-progress selection and restore whichever
  // product revision was active beforehand.
  function cancelNewRevision() {
    composingRevision.value = false;
    composeSelection.value = {};
    activeProductRevId.value = preComposeRevId.value;
    // Stay on composition. Cancelling restores the state you were in before
    // composing, and that state is now the composition view — bouncing to the
    // changelog would be a view switch the user never asked for.
    revPanelView.value = 'composition';
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
    if (!d) return;
    // Nothing to browse yet (no sub-products, so no revision can exist
    // either) — switch straight to Revisions mode so "New sub-product" is
    // immediately visible instead of making the user find the toggle. The
    // changelog would be empty in that state, so open the composition view.
    if (d.subProducts.length === 0) {
      revisionsMode.value = true;
      revPanelView.value = 'composition';
    }
    if (d.revisions.length === 0) return;
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
    // Back to the same default the ref is created with, so a second product
    // opens exactly like the first.
    revPanelView.value = 'composition';
    composingRevision.value = false;
    composeSelection.value = {};
  }

  return {
    activeProductRevId,
    selection,
    revisionsMode,
    revPanelView,
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
