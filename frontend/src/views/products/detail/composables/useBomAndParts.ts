import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { productRevisionsApi, subProductsApi } from '../../../../api/productsAPI.ts';
import { useNotificationStore } from '../../../../stores/notificationStore.ts';
import { translateApiError } from '../../../../utils/apiError.ts';
import type { BomSubProduct, RevisionPart, RevisionPartInput } from '../../../../types/products.ts';
import type { PanelScope, Selection } from '../types.ts';

interface SpRevLookup {
  (spId: number, revId: number): { sp?: { name: string }; rev?: { label: string } };
}

/** BOM / Parts tab: read-only BOM (product scope) or the editable part list
 *  of one sub-product revision (revisions mode), cached per revision. */
export function useBomAndParts(
  selection: Ref<Selection>,
  panelScope: ComputedRef<PanelScope | null>,
  spRevInfo: SpRevLookup,
  revisionLabel: (revId: number | null | undefined) => string,
) {
  const { t, te } = useI18n();
  const notify = useNotificationStore();

  const bomCache = new Map<number, BomSubProduct[]>();
  const partsCache = new Map<number, RevisionPart[]>();

  const bom = ref<BomSubProduct[]>([]);
  const parts = ref<RevisionPart[]>([]);
  const contentLoading = ref(false);
  let contentToken = 0;

  const partsSaving = ref(false);
  // Bumped whenever a revision's parts change, so the (separately cached)
  // Compare tab knows to drop its own cached diffs.
  const compareRefresh = ref(0);

  const bomHeaderChip = computed(() => {
    const scope = panelScope.value;
    if (!scope) return '';
    if (scope.kind === 'product') {
      const label = revisionLabel(scope.revId);
      return label !== '—' ? label : '';
    }
    const { sp, rev } = spRevInfo(scope.spId, scope.revId);
    return sp && rev ? t('bom_sub_rev_scope', { name: sp.name, label: rev.label }) : '';
  });

  async function loadContent(scope: PanelScope) {
    const token = ++contentToken;
    if (scope.kind === 'product') {
      const cached = bomCache.get(scope.revId);
      if (cached) {
        bom.value = cached;
        return;
      }
      contentLoading.value = true;
      try {
        const res = await productRevisionsApi.getBom(scope.revId);
        if (token !== contentToken) return;
        bomCache.set(scope.revId, res.data);
        bom.value = res.data;
      } catch {
        if (token === contentToken) bom.value = [];
      } finally {
        if (token === contentToken) contentLoading.value = false;
      }
      return;
    }

    const cached = partsCache.get(scope.revId);
    if (cached) {
      parts.value = cached;
      return;
    }
    contentLoading.value = true;
    try {
      const res = await subProductsApi.getRevisionParts(scope.spId, scope.revId);
      if (token !== contentToken) return;
      partsCache.set(scope.revId, res.data);
      parts.value = res.data;
    } catch (err: any) {
      if (token === contentToken) {
        parts.value = [];
        notify.showToast(translateApiError(err, { t, te }, 'errors.load_parts_failed'), 'error');
      }
    } finally {
      if (token === contentToken) contentLoading.value = false;
    }
  }

  async function onPartsUpdate(newParts: RevisionPartInput[]) {
    const sel = selection.value;
    if (sel.type !== 'subProduct' || partsSaving.value) return;
    partsSaving.value = true;
    try {
      const res = await subProductsApi.replaceRevisionParts(sel.spId, sel.spRevId, newParts);
      // Keep every consumer of this revision's parts in sync.
      partsCache.set(sel.spRevId, res.data);
      parts.value = res.data;
      bomCache.clear(); // BOMs embed these parts
      compareRefresh.value++; // compare tab caches part diffs
    } catch (err: any) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors.save_sub_product_revision_failed'),
        'error',
      );
    } finally {
      partsSaving.value = false;
    }
  }

  function clearCaches() {
    bomCache.clear();
    partsCache.clear();
  }

  function dropRevision(revId: number) {
    partsCache.delete(revId);
  }

  return {
    bom,
    parts,
    contentLoading,
    partsSaving,
    compareRefresh,
    bomHeaderChip,
    loadContent,
    onPartsUpdate,
    clearCaches,
    clearBomCache: () => bomCache.clear(),
    dropRevision,
  };
}
