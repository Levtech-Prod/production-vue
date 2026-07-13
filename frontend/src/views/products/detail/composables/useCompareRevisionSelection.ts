import { computed, onMounted, ref, watch } from 'vue';
import type { ProductDetail } from '../../../../types/products.ts';

export type CompareScope = 'product' | number; // 'product' or a sub-product id

/**
 * Owns which two revisions the Compare panel is looking at: the scope
 * (whole product vs one sub-product) and the A/B revision ids, plus the
 * label text shown in the header chips. Deliberately unaware of *what* gets
 * rendered for that pair — see useCompareProductRows / useCompareParts.
 */
export function useCompareRevisionSelection(props: {
  detail: ProductDetail;
  initialRevId?: number | null;
}) {
  const scope = ref<CompareScope>('product');
  const aId = ref<number | null>(props.initialRevId ?? null);
  const bId = ref<number | null>(null);

  const isSingle = computed(() => bId.value == null);

  const scopeRevisions = computed(() => {
    if (scope.value === 'product') return props.detail.revisions;
    return props.detail.subProducts.find((sp) => sp.id === scope.value)?.revisions ?? [];
  });

  const labelA = computed(
    () => scopeRevisions.value.find((r) => r.id === aId.value)?.label ?? '',
  );
  const labelB = computed(
    () => scopeRevisions.value.find((r) => r.id === bId.value)?.label ?? '',
  );

  /** Single revision → auto-select as A. Exactly two → A picked pairs B. */
  function autoPairB() {
    const revs = scopeRevisions.value;
    if (revs.length === 2 && aId.value != null && bId.value == null) {
      const other = revs.find((r) => r.id !== aId.value);
      if (other) bId.value = other.id;
    }
  }

  function applyAutoSelection() {
    const revs = scopeRevisions.value;
    if (revs.length === 1) {
      aId.value = revs[0].id;
      bId.value = null;
      return;
    }
    autoPairB();
  }

  onMounted(applyAutoSelection);

  // Changing scope resets the sides — unless the change came from jumpTo(),
  // which sets its own sides right after.
  let skipScopeReset = false;
  watch(scope, (next) => {
    if (skipScopeReset) {
      skipScopeReset = false;
      return;
    }
    aId.value = next === 'product' ? (props.initialRevId ?? null) : null;
    bId.value = null;
    applyAutoSelection();
  });

  watch(aId, () => autoPairB());

  function swapSides() {
    [aId.value, bId.value] = [bId.value, aId.value];
  }

  /** Jump straight to a specific scope + revision pair, bypassing the normal
   *  scope-change reset (used to drill from a product row into its parts). */
  function jumpTo(next: { scope: CompareScope; aId: number; bId: number }) {
    skipScopeReset = true;
    scope.value = next.scope;
    aId.value = next.aId;
    bId.value = next.bId;
  }

  return {
    scope,
    aId,
    bId,
    isSingle,
    scopeRevisions,
    labelA,
    labelB,
    swapSides,
    jumpTo,
  };
}

export type CompareRevisionSelection = ReturnType<typeof useCompareRevisionSelection>;
