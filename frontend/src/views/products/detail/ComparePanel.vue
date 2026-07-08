<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- ── Selectors ─────────────────────────────────────────────────────── -->
    <div class="flex shrink-0 flex-col gap-2.5 border-b border-slate-100 px-4 py-3">
      <div class="flex items-center gap-2">
        <label class="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
          {{ t('compare_scope') }}
        </label>
        <select v-model="scope" class="input !py-1.5 min-w-0 flex-1 text-sm">
          <option value="product">{{ t('product_revisions_title') }}</option>
          <option v-for="sp in detail.subProducts" :key="sp.id" :value="sp.id">
            {{ sp.name }}
          </option>
        </select>
      </div>

      <div class="flex items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">A</span>
          <select v-model="aId" class="input !py-1.5 min-w-0 flex-1 text-sm">
            <option :value="null" disabled>{{ t('select_revision') }}</option>
            <option
              v-for="rev in scopeRevisions"
              :key="rev.id"
              :value="rev.id"
              :disabled="rev.id === bId"
            >
              {{ rev.label }}
            </option>
          </select>
        </div>

        <button
          type="button"
          class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
          :title="t('swap_ab')"
          :disabled="aId == null || bId == null"
          @click="swapSides"
        >
          <ArrowLeftRight class="h-4 w-4" />
        </button>

        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">B</span>
          <select v-model="bId" class="input !py-1.5 min-w-0 flex-1 text-sm">
            <option :value="null">{{ t('select_revision') }}</option>
            <option
              v-for="rev in scopeRevisions"
              :key="rev.id"
              :value="rev.id"
              :disabled="rev.id === aId"
            >
              {{ rev.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <!-- ── Result ───────────────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto">
      <!-- Nothing selected yet -->
      <div v-if="aId == null" class="px-4 py-8 text-center text-sm text-slate-400">
        {{ t('compare_select_hint') }}
      </div>

      <!-- ── Product revisions ──────────────────────────────────────────── -->
      <template v-else-if="scope === 'product'">
        <div v-if="!productRows || productRows.length === 0" class="px-4 py-8 text-center text-sm text-slate-400">
          {{ t('no_linked_sub_products') }}
        </div>
        <table v-else class="w-full table-fixed text-sm">
          <colgroup v-if="isSingle">
            <col style="width: 30%" />
            <col style="width: 70%" />
          </colgroup>
          <colgroup v-else>
            <col style="width: 27%" />
            <col style="width: 36.5%" />
            <col style="width: 36.5%" />
          </colgroup>
          <thead>
            <tr class="border-b border-slate-200">
              <th class="px-4 py-2"></th>
              <th class="bg-blue-50/60 px-3 py-2 text-left">
                <span class="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                  <span class="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">A</span>
                  <span class="truncate">{{ labelA }}</span>
                </span>
              </th>
              <th v-if="!isSingle" class="bg-emerald-50/60 px-3 py-2 text-left">
                <span class="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <span class="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">B</span>
                  <span class="truncate">{{ labelB }}</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody v-for="row in productRows" :key="row.spId">
            <!-- Sub-product name row -->
            <tr>
              <td :colspan="isSingle ? 2 : 3" class="border-t-4 border-slate-100 bg-slate-50 px-4 py-2">
                <div class="flex items-center gap-2.5">
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-semibold text-slate-800">{{ row.name }}</div>
                    <div class="truncate font-mono text-xs text-slate-400">{{ row.sku }}</div>
                  </div>
                  <span
                    v-if="row.status"
                    class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    :class="compareStatusChipClass(row.status)"
                  >
                    {{ t('compare_status.' + row.status) }}
                  </span>
                  <button
                    v-if="row.status === 'changed' && row.revA && row.revB"
                    type="button"
                    class="inline-flex shrink-0 items-center gap-0.5 rounded-md px-2 py-0.5 text-xs text-slate-500 hover:bg-white hover:text-blue-600"
                    @click="drillIntoParts(row)"
                  >
                    {{ t('compare_parts') }}
                    <ChevronRight class="h-3 w-3" />
                  </button>
                </div>
              </td>
            </tr>
            <!-- Linked revision row -->
            <tr class="border-t border-slate-50">
              <td class="px-4 py-1.5 align-top text-xs text-slate-400">{{ t('linked_revision') }}</td>
              <td class="px-3 py-1.5" :class="matchCellClass(row.same, row.revA != null)">
                {{ row.revA?.label ?? '—' }}
              </td>
              <td v-if="!isSingle" class="px-3 py-1.5" :class="matchCellClass(row.same, row.revB != null)">
                {{ row.revB?.label ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ── Sub-product revision parts ─────────────────────────────────── -->
      <template v-else>
        <div v-if="partsLoading" class="py-8 text-center text-sm text-slate-400">
          {{ t('loading') }}
        </div>
        <template v-else-if="partsResult">
          <!-- Status filter bar (only when actually comparing) -->
          <div
            v-if="!isSingle && partsSummary"
            class="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-white/95 px-4 py-2 backdrop-blur"
          >
            <button
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
              :class="
                statusFilter === 'all'
                  ? 'border-slate-500 bg-slate-700 text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300'
              "
              @click="statusFilter = 'all'"
            >
              {{ t('all') }} · {{ partsResult.parts.length }}
            </button>
            <button
              v-for="f in statusFilters"
              :key="f.status"
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-35"
              :class="statusFilter === f.status ? f.activeClass : f.idleClass"
              :disabled="partsSummary[f.status] === 0"
              @click="statusFilter = statusFilter === f.status ? 'all' : f.status"
            >
              {{ f.sign }}{{ partsSummary[f.status] }}
              {{ t('compare_status.' + f.status).toLowerCase() }}
            </button>
          </div>

          <div v-if="filteredParts.length === 0" class="py-8 text-center text-sm text-slate-400">
            {{ t('no_parts_in_revision') }}
          </div>
          <table v-else class="w-full table-fixed text-sm">
            <colgroup v-if="isSingle">
              <col style="width: 30%" />
              <col style="width: 70%" />
            </colgroup>
            <colgroup v-else>
              <col style="width: 27%" />
              <col style="width: 36.5%" />
              <col style="width: 36.5%" />
            </colgroup>
            <thead>
              <tr class="border-b border-slate-200">
                <th class="px-4 py-2"></th>
                <th class="bg-blue-50/60 px-3 py-2 text-left">
                  <span class="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                    <span class="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">A</span>
                    <span class="truncate">{{ labelA }}</span>
                  </span>
                </th>
                <th v-if="!isSingle" class="bg-emerald-50/60 px-3 py-2 text-left">
                  <span class="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <span class="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">B</span>
                    <span class="truncate">{{ labelB }}</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody v-for="row in filteredParts" :key="row.partId">
              <!-- Part name row -->
              <tr>
                <td :colspan="isSingle ? 2 : 3" class="border-t-4 border-slate-100 bg-slate-50 px-4 py-2">
                  <div class="flex items-center gap-2.5">
                    <img
                      v-if="row.image"
                      :src="row.image"
                      class="h-8 w-8 shrink-0 rounded-md border border-slate-200 object-cover"
                      :alt="row.name"
                    />
                    <div
                      v-else
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] text-slate-300"
                    >
                      ▣
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-semibold text-slate-800">{{ row.name }}</div>
                      <div class="truncate font-mono text-xs text-slate-400">{{ row.code }}</div>
                    </div>
                    <span
                      v-if="!isSingle"
                      class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      :class="compareStatusChipClass(row.status)"
                    >
                      {{ t('compare_status.' + row.status) }}
                    </span>
                  </div>
                </td>
              </tr>

              <!-- Compact details row (part-level, identical on both sides) -->
              <tr v-if="hasDetails(row)" class="border-t border-slate-50">
                <td
                  :colspan="isSingle ? 2 : 3"
                  class="px-4 py-1.5 text-[11px] leading-5 text-slate-600"
                >
                  <span v-if="row.categoryName" class="mr-3 inline-block">
                    <span class="text-slate-400">{{ t('category') }}:</span>
                    {{ row.categoryName }}
                  </span>
                  <span
                    v-if="row.pricePerPiece != null && row.pricePerPiece !== ''"
                    class="mr-3 inline-block tabular-nums"
                  >
                    <span class="text-slate-400">{{ t('price_per_piece') }}:</span>
                    {{ row.pricePerPiece }}
                  </span>
                  <span
                    v-for="(param, i) in row.parameters ?? []"
                    :key="i"
                    class="mr-3 inline-block"
                  >
                    <span class="text-slate-400">{{ param.name }}:</span>
                    {{ param.value }}{{ param.unit ? ` ${param.unit}` : '' }}
                  </span>
                </td>
              </tr>

              <!-- Quantity row -->
              <tr class="border-t border-slate-50">
                <td class="px-4 py-1.5 align-top text-xs text-slate-400">{{ t('quantity') }}</td>
                <td
                  class="px-3 py-1.5 tabular-nums"
                  :class="matchCellClass(qtySame(row), row.inA != null)"
                >
                  {{ sideQty(row.inA) }}
                </td>
                <td
                  v-if="!isSingle"
                  class="px-3 py-1.5 tabular-nums"
                  :class="matchCellClass(qtySame(row), row.inB != null)"
                >
                  {{ sideQty(row.inB) }}
                  <span v-if="qtyDelta(row)" class="ml-1 text-xs">({{ qtyDelta(row) }})</span>
                </td>
              </tr>

              <!-- Notes row -->
              <tr v-if="row.inA?.notes || row.inB?.notes" class="border-t border-slate-50">
                <td class="px-4 py-1.5 align-top text-xs text-slate-400">{{ t('notes') }}</td>
                <td class="px-3 py-1.5 text-xs" :class="matchCellClass(notesSame(row), !!row.inA?.notes)">
                  {{ row.inA?.notes || '—' }}
                </td>
                <td
                  v-if="!isSingle"
                  class="px-3 py-1.5 text-xs"
                  :class="matchCellClass(notesSame(row), !!row.inB?.notes)"
                >
                  {{ row.inB?.notes || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowLeftRight, ChevronRight } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { subProductsApi } from '../../../api/productsAPI.ts';
import { translateApiError } from '../../../utils/apiError.ts';
import { useNotificationStore } from '../../../stores/notificationStore.ts';
import type {
  ProductDetail,
  SubProductRevision,
  ComparePartsResult,
  ComparePartRow,
  ComparePartSide,
  CompareStatus,
} from '../../../types/products.ts';

const props = defineProps<{
  detail: ProductDetail;
  /** Preselected revision for side A when the panel opens in product scope. */
  initialRevId?: number | null;
  /** Bump to invalidate cached parts comparisons (e.g. after editing parts). */
  refreshToken?: number;
}>();

const { t, te } = useI18n();
const notify = useNotificationStore();

// ── Scope + side selection ───────────────────────────────────────────────────

type Scope = 'product' | number; // 'product' or a sub-product id
const scope = ref<Scope>('product');
const aId = ref<number | null>(props.initialRevId ?? null);
const bId = ref<number | null>(null);

const isSingle = computed(() => bId.value == null);

const scopeRevisions = computed(() => {
  if (scope.value === 'product') return props.detail.revisions;
  return props.detail.subProducts.find((sp) => sp.id === scope.value)?.revisions ?? [];
});

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

// Changing scope resets the sides (except drill-downs, which set their own).
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

const labelA = computed(() => scopeRevisions.value.find((r) => r.id === aId.value)?.label ?? '');
const labelB = computed(() => scopeRevisions.value.find((r) => r.id === bId.value)?.label ?? '');

// ── Product revision rows (client-side, from membership) ────────────────────

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

interface ProductRow {
  spId: number;
  name: string;
  sku: string;
  revA: SubProductRevision | null;
  revB: SubProductRevision | null;
  status: CompareStatus | null; // null in single mode
  same: boolean | null; // null in single mode
}

const productRows = computed<ProductRow[] | null>(() => {
  if (scope.value !== 'product' || aId.value == null) return null;
  const setA = membershipMap.value.get(aId.value) ?? new Set<number>();
  const setB = bId.value != null ? (membershipMap.value.get(bId.value) ?? new Set<number>()) : null;
  const rows: ProductRow[] = [];
  for (const sp of props.detail.subProducts) {
    const revA = sp.revisions.find((r) => setA.has(r.id)) ?? null;
    const revB = setB ? (sp.revisions.find((r) => setB.has(r.id)) ?? null) : null;
    if (!setB) {
      // Single mode: only what's in A.
      if (revA) rows.push({ spId: sp.id, name: sp.name, sku: sp.sku, revA, revB: null, status: null, same: null });
      continue;
    }
    if (!revA && !revB) continue;
    const status: CompareStatus =
      revA && revB ? (revA.id === revB.id ? 'unchanged' : 'changed') : revA ? 'removed' : 'added';
    rows.push({
      spId: sp.id,
      name: sp.name,
      sku: sp.sku,
      revA,
      revB,
      status,
      same: status === 'unchanged',
    });
  }
  return rows;
});

function drillIntoParts(row: ProductRow) {
  if (!row.revA || !row.revB) return;
  skipScopeReset = true;
  scope.value = row.spId;
  aId.value = row.revA.id;
  bId.value = row.revB.id;
}

// ── Parts (server, cached; single mode compares a revision with itself) ─────

const partsResult = ref<ComparePartsResult | null>(null);
const partsLoading = ref(false);
const partsCache = new Map<string, ComparePartsResult>();
let partsToken = 0;

async function loadParts() {
  partsResult.value = null;
  statusFilter.value = 'all';
  const a = aId.value;
  if (scope.value === 'product' || a == null) return;
  const bb = bId.value ?? a; // single mode: A vs itself gives the full part details
  const key = `${a}:${bb}`;
  const cached = partsCache.get(key);
  if (cached) {
    partsResult.value = cached;
    return;
  }
  const token = ++partsToken;
  partsLoading.value = true;
  try {
    const res = await subProductsApi.compareRevisionParts(a, bb);
    if (token !== partsToken) return;
    partsCache.set(key, res.data);
    partsResult.value = res.data;
  } catch (err: any) {
    if (token === partsToken) {
      notify.showToast(translateApiError(err, { t, te }, 'errors.load_parts_failed'), 'error');
    }
  } finally {
    if (token === partsToken) partsLoading.value = false;
  }
}

watch([scope, aId, bId], () => void loadParts(), { immediate: true });

// Parts were edited elsewhere — drop the cache and refetch the current view.
watch(
  () => props.refreshToken,
  () => {
    partsCache.clear();
    void loadParts();
  },
);

const partsSummary = computed(() => {
  if (!partsResult.value) return null;
  const p = partsResult.value.parts;
  return {
    added: p.filter((r) => r.status === 'added').length,
    removed: p.filter((r) => r.status === 'removed').length,
    changed: p.filter((r) => r.status === 'changed').length,
    unchanged: p.filter((r) => r.status === 'unchanged').length,
  };
});

// ── Status filter ────────────────────────────────────────────────────────────

const statusFilter = ref<CompareStatus | 'all'>('all');

const statusFilters: Array<{
  status: CompareStatus;
  sign: string;
  activeClass: string;
  idleClass: string;
}> = [
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

const filteredParts = computed<ComparePartRow[]>(() => {
  const rows = partsResult.value?.parts ?? [];
  if (isSingle.value || statusFilter.value === 'all') return rows;
  return rows.filter((r) => r.status === statusFilter.value);
});

// ── Cell helpers ─────────────────────────────────────────────────────────────

function hasDetails(row: ComparePartRow): boolean {
  return (
    !!row.categoryName ||
    (row.pricePerPiece != null && row.pricePerPiece !== '') ||
    (row.parameters?.length ?? 0) > 0
  );
}

function sideQty(side: ComparePartSide | null): string {
  if (!side) return '—';
  return `${side.quantity}${side.unit ? ` ${side.unit}` : ''}`;
}

function qtySame(row: ComparePartRow): boolean | null {
  if (isSingle.value) return null;
  if (!row.inA || !row.inB) return false;
  return sideQty(row.inA) === sideQty(row.inB);
}

function notesSame(row: ComparePartRow): boolean | null {
  if (isSingle.value) return null;
  return (row.inA?.notes ?? '') === (row.inB?.notes ?? '');
}

function qtyDelta(row: ComparePartRow): string {
  if (isSingle.value || !row.inA || !row.inB) return '';
  const d = Number(row.inB.quantity) - Number(row.inA.quantity);
  if (Number.isNaN(d) || d === 0) return '';
  return d > 0 ? `+${d}` : `${d}`;
}

/** Green when the two sides match, red when they differ, neutral in single mode. */
function matchCellClass(same: boolean | null, present: boolean): string {
  if (same === null) return 'text-slate-700';
  if (same) return 'bg-emerald-50/70 font-medium text-emerald-700';
  return present ? 'bg-red-50/70 font-medium text-red-600' : 'bg-red-50/70 text-red-300';
}

// Green = same, red = any difference (added / removed / changed).
function compareStatusChipClass(status: CompareStatus): string {
  return (
    {
      added: 'bg-red-100 text-red-700',
      removed: 'bg-red-100 text-red-700',
      changed: 'bg-red-100 text-red-700',
      unchanged: 'bg-emerald-100 text-emerald-700',
    }[status] ?? 'bg-slate-100 text-slate-500'
  );
}
</script>
