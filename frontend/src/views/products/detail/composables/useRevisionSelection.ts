import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import type {
  DetailSubProduct,
  ProductDetail,
  SubProductRevision,
} from '../../../../types/products.ts';
import { linkedRevOf as resolveLinkedRev } from '../revisionHelpers.ts';
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
  // True while the compose checkboxes in the left tree are interactive —
  // either building a new product revision ("Add new revision") or editing an
  // existing one's composition ("Edit composition").
  const composingRevision = ref(false);
  // Which revision is being composed: null = a new one, otherwise the id of
  // the existing revision whose composition is being edited.
  const composeTargetRevId = ref<number | null>(null);
  const composeSelection = ref<ComposeSelection>({});
  // What the composition looked like when composing started, so the save
  // summary can diff against it and Save can stay disabled until it differs.
  const composeBaseline = ref<ComposeSelection>({});

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

  /** The sub-product revisions a product revision links, as a compose map. */
  function compositionOf(productRevId: number | null): ComposeSelection {
    const out: ComposeSelection = {};
    if (productRevId == null) return out;
    for (const sp of detail.value?.subProducts ?? []) {
      const rev = linkedRevOf(sp, productRevId);
      if (rev) out[sp.id] = rev.id;
    }
    return out;
  }

  /** Whether the in-progress composition differs from what it started as. */
  const composeDirty = computed(() => {
    const base = composeBaseline.value;
    const now = composeSelection.value;
    const spIds = new Set([...Object.keys(base), ...Object.keys(now)]);
    return [...spIds].some((k) => base[Number(k)] !== now[Number(k)]);
  });

  function toggleRevisionsMode() {
    revisionsMode.value = !revisionsMode.value;
    stopComposing();
  }

  /** Leave compose mode, keeping whichever revision is active. */
  function stopComposing() {
    composingRevision.value = false;
    composeTargetRevId.value = null;
    composeSelection.value = {};
    composeBaseline.value = {};
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
    composeBaseline.value = {};
    composeTargetRevId.value = null;
    activeProductRevId.value = null;
    if (selection.value.type === 'subProduct') selection.value = { type: 'product' };
    composingRevision.value = true;
  }

  // Edit the ACTIVE revision's composition: same checkboxes, seeded with what
  // that revision already links. The revision stays active throughout, so the
  // rest of the page keeps describing the thing being edited.
  function startEditComposition() {
    const revId = activeProductRevId.value;
    if (revId == null) return;
    preComposeRevId.value = revId;
    composeTargetRevId.value = revId;
    composeBaseline.value = compositionOf(revId);
    composeSelection.value = { ...composeBaseline.value };
    composingRevision.value = true;
  }

  // Cancel composing: drop the in-progress selection and restore whichever
  // product revision was active beforehand (the edited one, when editing).
  function cancelComposing() {
    stopComposing();
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
  // whole sub-product — was deleted elsewhere). Dropped from the baseline too:
  // the link is gone from the database as well, so it is not a pending change.
  function dropFromComposition(spId: number, revId?: number) {
    if (!composingRevision.value) return;
    if (composeSelection.value[spId] == null) return;
    if (revId != null && composeSelection.value[spId] !== revId) return;
    const next = { ...composeSelection.value };
    delete next[spId];
    composeSelection.value = next;
    const base = { ...composeBaseline.value };
    delete base[spId];
    composeBaseline.value = base;
  }

  /** Record a link that was just saved elsewhere (e.g. a sub-product created
   *  straight into the revision being edited) so the pending composition does
   *  not read as "remove it again". */
  function adoptSavedLink(spId: number, revId: number) {
    if (!composingRevision.value) return;
    composeSelection.value = { ...composeSelection.value, [spId]: revId };
    composeBaseline.value = { ...composeBaseline.value, [spId]: revId };
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
    // immediately visible instead of making the user find the toggle.
    if (d.subProducts.length === 0) {
      revisionsMode.value = true;
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
    stopComposing();
  }

  return {
    activeProductRevId,
    selection,
    revisionsMode,
    composingRevision,
    composeTargetRevId,
    composeSelection,
    composeBaseline,
    composeDirty,
    membershipMap,
    revisionLabel,
    defaultRevisionLabel,
    setActiveRevision,
    onSelect,
    toggleRevisionsMode,
    startNewRevision,
    startEditComposition,
    cancelComposing,
    stopComposing,
    toggleCompose,
    dropFromComposition,
    adoptSavedLink,
    spRevInfo,
    applyDefaults,
    resetForProductChange,
  };
}
