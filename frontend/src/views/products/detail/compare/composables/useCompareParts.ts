import { computed, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { subProductsApi } from '../../../../../api/productsAPI.ts';
import { translateApiError } from '../../../../../utils/apiError.ts';
import { useNotificationStore } from '../../../../../stores/notificationStore.ts';
import type {
  ComparePartRow,
  ComparePartsResult,
  CompareStatus,
} from '../../../../../types/products.ts';
import { statusRank } from '../compareHelpers.ts';
import type { CompareScope } from './useCompareRevisionSelection.ts';

export interface StatusFilterDef {
  status: CompareStatus;
  sign: string;
  activeClass: string;
  idleClass: string;
}

/** Red for any kind of difference, green for the "unchanged" filter — same
 *  status palette used everywhere else in the panel. */
const STATUS_FILTERS: StatusFilterDef[] = [
  {
    status: 'added',
    sign: '+',
    activeClass: 'border-red-500 bg-red-600 text-white',
    idleClass: 'border-red-200 text-red-700 hover:border-red-300',
  },
  {
    status: 'changed',
    sign: '~',
    activeClass: 'border-red-500 bg-red-600 text-white',
    idleClass: 'border-red-200 text-red-700 hover:border-red-300',
  },
  {
    status: 'removed',
    sign: '−',
    activeClass: 'border-red-500 bg-red-600 text-white',
    idleClass: 'border-red-200 text-red-700 hover:border-red-300',
  },
  {
    status: 'unchanged',
    sign: '',
    activeClass: 'border-emerald-500 bg-emerald-600 text-white',
    idleClass: 'border-emerald-200 text-emerald-600 hover:border-emerald-300',
  },
];

/**
 * Fetches & caches side-by-side part comparisons for one sub-product
 * revision pair, plus the status filter used to narrow the row list. In
 * single mode (no B side), comparing a revision with itself returns its
 * full part details, so the same endpoint powers both views.
 */
export function useCompareParts(
  scope: Ref<CompareScope>,
  aId: Ref<number | null>,
  bId: Ref<number | null>,
  isSingle: Ref<boolean>,
  refreshToken: Ref<number | undefined>,
) {
  const { t, te } = useI18n();
  const notify = useNotificationStore();

  const partsResult = ref<ComparePartsResult | null>(null);
  const partsLoading = ref(false);
  const statusFilter = ref<CompareStatus | 'all'>('all');

  const partsCache = new Map<string, ComparePartsResult>();
  let requestToken = 0;

  async function loadParts() {
    partsResult.value = null;
    statusFilter.value = 'all';
    const a = aId.value;
    if (scope.value === 'product' || a == null) return;

    const b = bId.value ?? a; // single mode: A vs itself gives the full part details
    const key = `${a}:${b}`;
    const cached = partsCache.get(key);
    if (cached) {
      partsResult.value = cached;
      return;
    }

    const token = ++requestToken;
    partsLoading.value = true;
    try {
      const res = await subProductsApi.compareRevisionParts(a, b);
      if (token !== requestToken) return;
      partsCache.set(key, res.data);
      partsResult.value = res.data;
    } catch (err: any) {
      if (token === requestToken) {
        notify.showToast(translateApiError(err, { t, te }, 'errors.load_parts_failed'), 'error');
      }
    } finally {
      if (token === requestToken) partsLoading.value = false;
    }
  }

  watch([scope, aId, bId], () => void loadParts(), { immediate: true });

  // Parts were edited elsewhere — drop the cache and refetch the current view.
  watch(refreshToken, () => {
    partsCache.clear();
    void loadParts();
  });

  const partsSummary = computed(() => {
    if (!partsResult.value) return null;
    const rows = partsResult.value.parts;
    return {
      added: rows.filter((r) => r.status === 'added').length,
      removed: rows.filter((r) => r.status === 'removed').length,
      changed: rows.filter((r) => r.status === 'changed').length,
      unchanged: rows.filter((r) => r.status === 'unchanged').length,
    };
  });

  const filteredParts = computed<ComparePartRow[]>(() => {
    const rows = partsResult.value?.parts ?? [];
    const filtered =
      isSingle.value || statusFilter.value === 'all'
        ? rows
        : rows.filter((r) => r.status === statusFilter.value);
    // Identical first, then changed-in-both, then only-in-one-side last.
    return [...filtered].sort((a, b) => statusRank(a.status) - statusRank(b.status));
  });

  return {
    partsResult,
    partsLoading,
    partsSummary,
    statusFilter,
    statusFilters: STATUS_FILTERS,
    filteredParts,
  };
}
