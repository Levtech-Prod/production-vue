<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- ── Selectors ─────────────────────────────────────────────────────── -->
    <div
      class="flex shrink-0 flex-col gap-2.5 border-b border-slate-100 px-4 py-3"
    >
      <div class="flex items-center gap-2">
        <label
          class="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400"
        >
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
          <span
            class="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
            >A</span
          >
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
          <span
            class="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
            >B</span
          >
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
      <div
        v-if="aId == null"
        class="px-4 py-8 text-center text-sm text-slate-400"
      >
        {{ t('compare_select_hint') }}
      </div>

      <!-- ── Product revisions ──────────────────────────────────────────── -->
      <template v-else-if="scope === 'product'">
        <div
          v-if="!productRows || productRows.length === 0"
          class="px-4 py-8 text-center text-sm text-slate-400"
        >
          {{ t('no_linked_sub_products') }}
        </div>
        <div v-else>
          <!-- Header -->
          <div class="border-b border-slate-200 px-3 py-2">
            <div
              class="grid items-center gap-x-2"
              :class="
                isSingle
                  ? 'grid-cols-[minmax(0,1fr)]'
                  : 'grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]'
              "
            >
              <div
                class="flex items-center gap-1.5 rounded-md bg-blue-50/60 px-2 py-1"
              >
                <span
                  class="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                  >A</span
                >
                <span class="truncate text-xs font-semibold text-blue-700">{{
                  labelA
                }}</span>
              </div>
              <div v-if="!isSingle"></div>
              <div
                v-if="!isSingle"
                class="flex items-center gap-1.5 rounded-md bg-emerald-50/60 px-2 py-1"
              >
                <span
                  class="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                  >B</span
                >
                <span class="truncate text-xs font-semibold text-emerald-700">{{
                  labelB
                }}</span>
              </div>
            </div>
            <div
              class="mt-1 grid items-center gap-x-2"
              :class="
                isSingle
                  ? 'grid-cols-[minmax(0,1fr)]'
                  : 'grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]'
              "
            >
              <div
                class="grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"
              >
                <div></div>
                <div>{{ t('name') }} / {{ t('sku') }}</div>
                <div class="text-center">{{ t('linked_revision') }}</div>
              </div>
              <div v-if="!isSingle"></div>
              <div
                v-if="!isSingle"
                class="grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"
              >
                <div></div>
                <div>{{ t('name') }} / {{ t('sku') }}</div>
                <div class="text-center">{{ t('linked_revision') }}</div>
              </div>
            </div>
          </div>

          <!-- Rows -->
          <div
            v-for="row in productRows"
            :key="row.spId"
            class="grid items-stretch gap-x-2 border-t border-slate-100 px-3 py-2"
            :class="
              isSingle
                ? 'grid-cols-[minmax(0,1fr)]'
                : 'grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]'
            "
          >
            <!-- Side A -->
            <div
              v-if="row.revA"
              class="grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 rounded-md px-1.5 py-1"
              :class="sideAccentClass(row.same)"
            >
              <div
                class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-300"
              >
                <img
                  v-if="row.image"
                  :src="row.image"
                  class="h-full w-full object-cover"
                  :alt="row.name"
                />
                <template v-else>▣</template>
              </div>
              <div class="min-w-0 break-words">
                <div class="font-semibold text-slate-800">{{ row.name }}</div>
                <div class="font-mono text-xs text-slate-400">
                  {{ row.sku }}
                </div>
              </div>
              <div class="min-w-0 break-words">
                <div class="text-xs text-slate-600 text-center">
                  {{ row.revA.label }}
                </div>
                <button
                  v-if="row.status === 'changed' && row.revB"
                  type="button"
                  class="mt-0.5 inline-flex items-center gap-0.5 text-xs text-slate-400 hover:text-blue-600"
                  @click="drillIntoParts(row)"
                >
                  {{ t('compare_parts') }}
                  <ChevronRight class="h-3 w-3" />
                </button>
              </div>
            </div>
            <div
              v-else
              class="grid min-h-[2.75rem] place-items-center rounded-md border border-dashed border-slate-200 text-xs text-slate-300"
            >
              {{ t('not_in_this_revision') }}
            </div>

            <!-- Status -->
            <div v-if="!isSingle" class="flex items-start justify-center pt-1">
              <span
                v-if="row.status === 'unchanged'"
                class="h-2.5 w-2.5 rounded-full bg-emerald-500"
                :title="t('compare_status.unchanged')"
              ></span>
              <span
                v-else
                class="grid h-4 w-4 place-items-center rounded-full bg-red-100 text-[10px] font-bold leading-none text-red-700"
                :title="t('compare_status.' + row.status)"
              >
                {{ statusSign(row.status) }}
              </span>
            </div>

            <!-- Side B -->
            <template v-if="!isSingle">
              <div
                v-if="row.revB"
                class="grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 rounded-md px-1.5 py-1"
                :class="sideAccentClass(row.same)"
              >
                <div
                  class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-300"
                >
                  <img
                    v-if="row.image"
                    :src="row.image"
                    class="h-full w-full object-cover"
                    :alt="row.name"
                  />
                  <template v-else>▣</template>
                </div>
                <div class="min-w-0 break-words">
                  <div class="font-semibold text-slate-800">{{ row.name }}</div>
                  <div class="font-mono text-xs text-slate-400">
                    {{ row.sku }}
                  </div>
                </div>
                <div
                  class="min-w-0 break-words text-xs text-slate-600 text-center"
                >
                  {{ row.revB.label }}
                </div>
              </div>
              <div
                v-else
                class="grid min-h-[2.75rem] place-items-center rounded-md border border-dashed border-slate-200 text-xs text-slate-300"
              >
                {{ t('not_in_this_revision') }}
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- ── Sub-product revision parts ─────────────────────────────────── -->
      <template v-else>
        <div
          v-if="partsLoading"
          class="py-8 text-center text-sm text-slate-400"
        >
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
              @click="
                statusFilter = statusFilter === f.status ? 'all' : f.status
              "
            >
              {{ f.sign }}{{ partsSummary[f.status] }}
              {{ t('compare_status.' + f.status).toLowerCase() }}
            </button>
          </div>

          <div
            v-if="filteredParts.length === 0"
            class="py-8 text-center text-sm text-slate-400"
          >
            {{ t('no_parts_in_revision') }}
          </div>
          <div v-else>
            <!-- Header -->
            <div class="border-b border-slate-200 px-3 py-2">
              <div
                class="grid items-center gap-x-2"
                :class="
                  isSingle
                    ? 'grid-cols-[minmax(0,1fr)]'
                    : 'grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]'
                "
              >
                <div
                  class="flex items-center gap-1.5 rounded-md bg-blue-50/60 px-2 py-1"
                >
                  <span
                    class="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                    >A</span
                  >
                  <span class="truncate text-xs font-semibold text-blue-700">{{
                    labelA
                  }}</span>
                </div>
                <div v-if="!isSingle"></div>
                <div
                  v-if="!isSingle"
                  class="flex items-center gap-1.5 rounded-md bg-emerald-50/60 px-2 py-1"
                >
                  <span
                    class="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                    >B</span
                  >
                  <span
                    class="truncate text-xs font-semibold text-emerald-700"
                    >{{ labelB }}</span
                  >
                </div>
              </div>
              <div
                class="mt-1 grid items-center gap-x-2"
                :class="
                  isSingle
                    ? 'grid-cols-[minmax(0,1fr)]'
                    : 'grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]'
                "
              >
                <div
                  class="grid grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,3fr)] items-center gap-x-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"
                >
                  <div></div>
                  <div>{{ t('name') }} / {{ t('code') }}</div>
                  <div class="text-center">{{ t('quantity') }}</div>
                  <div>{{ t('parameters') }}</div>
                </div>
                <div v-if="!isSingle"></div>
                <div
                  v-if="!isSingle"
                  class="grid grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,3fr)] items-center gap-x-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"
                >
                  <div></div>
                  <div>{{ t('name') }} / {{ t('code') }}</div>
                  <div class="text-center">{{ t('quantity') }}</div>
                  <div>{{ t('parameters') }}</div>
                </div>
              </div>
            </div>

            <!-- Rows -->
            <div
              v-for="row in filteredParts"
              :key="row.partId"
              class="grid items-stretch gap-x-2 border-t border-slate-100 px-3 py-2"
              :class="
                isSingle
                  ? 'grid-cols-[minmax(0,1fr)]'
                  : 'grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]'
              "
            >
              <!-- Side A -->
              <div
                v-if="row.inA"
                class="grid grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,3fr)] items-start gap-x-2 rounded-md px-1.5 py-1"
                :class="sideAccentClass(partSame(row))"
              >
                <div
                  class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-300"
                >
                  <img
                    v-if="row.image"
                    :src="row.image"
                    class="h-full w-full object-cover"
                    :alt="row.name"
                  />
                  <template v-else>▣</template>
                </div>
                <div class="min-w-0 break-words">
                  <div class="font-semibold text-slate-800">{{ row.name }}</div>
                  <div class="font-mono text-xs text-slate-400">
                    {{ row.code }}
                  </div>
                </div>
                <div
                  class="break-words text-center text-xs font-medium tabular-nums text-slate-700"
                >
                  {{ sideQty(row.inA) }}
                </div>
                <div class="min-w-0 self-center break-words">
                  <template v-if="hasDetails(row)">
                    <div
                      v-if="row.categoryName"
                      class="text-[11px] leading-4 text-slate-600"
                    >
                      {{ row.categoryName }}
                    </div>
                    <div
                      v-if="
                        row.pricePerPiece != null && row.pricePerPiece !== ''
                      "
                      class="text-[11px] leading-4 tabular-nums text-slate-600"
                    >
                      {{ row.pricePerPiece }}
                    </div>
                    <div
                      v-for="(param, i) in row.parameters ?? []"
                      :key="i"
                      class="text-[11px] leading-4 text-slate-600"
                    >
                      <span class="text-slate-400">{{ param.name }}:</span>
                      {{ param.value }}{{ param.unit ? ` ${param.unit}` : '' }}
                    </div>
                  </template>
                  <div v-else class="text-[11px] text-slate-300">—</div>
                  <div v-if="row.inA.notes" class="text-[10px] text-slate-400">
                    {{ t('notes') }}: {{ row.inA.notes }}
                  </div>
                </div>
              </div>
              <div
                v-else
                class="grid min-h-[2.75rem] place-items-center rounded-md border border-dashed border-slate-200 text-xs text-slate-300"
              >
                {{ t('not_in_this_revision') }}
              </div>

              <!-- Status -->
              <div
                v-if="!isSingle"
                class="flex items-start justify-center pt-1"
              >
                <span
                  v-if="row.status === 'unchanged'"
                  class="h-2.5 w-2.5 rounded-full bg-emerald-500"
                  :title="t('compare_status.unchanged')"
                ></span>
                <span
                  v-else
                  class="grid h-4 w-4 place-items-center rounded-full bg-red-100 text-[10px] font-bold leading-none text-red-700"
                  :title="t('compare_status.' + row.status)"
                >
                  {{ statusSign(row.status) }}
                </span>
              </div>

              <!-- Side B -->
              <template v-if="!isSingle">
                <div
                  v-if="row.inB"
                  class="grid grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,3fr)] items-start gap-x-2 rounded-md px-1.5 py-1"
                  :class="sideAccentClass(partSame(row))"
                >
                  <div
                    class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-300"
                  >
                    <img
                      v-if="row.image"
                      :src="row.image"
                      class="h-full w-full object-cover"
                      :alt="row.name"
                    />
                    <template v-else>▣</template>
                  </div>
                  <div class="min-w-0 break-words">
                    <div class="font-semibold text-slate-800">
                      {{ row.name }}
                    </div>
                    <div class="font-mono text-xs text-slate-400">
                      {{ row.code }}
                    </div>
                  </div>
                  <div class="min-w-0 break-words text-center">
                    <div
                      class="text-xs font-medium tabular-nums text-slate-700"
                    >
                      {{ sideQty(row.inB) }}
                    </div>
                    <div
                      v-if="qtyDelta(row)"
                      class="text-[10px] text-slate-400"
                    >
                      ({{ qtyDelta(row) }})
                    </div>
                  </div>
                  <div class="min-w-0 self-center break-words">
                    <template v-if="hasDetails(row)">
                      <div
                        v-if="row.categoryName"
                        class="text-[11px] leading-4 text-slate-600"
                      >
                        {{ row.categoryName }}
                      </div>
                      <div
                        v-if="
                          row.pricePerPiece != null && row.pricePerPiece !== ''
                        "
                        class="text-[11px] leading-4 tabular-nums text-slate-600"
                      >
                        {{ row.pricePerPiece }}
                      </div>
                      <div
                        v-for="(param, i) in row.parameters ?? []"
                        :key="i"
                        class="text-[11px] leading-4 text-slate-600"
                      >
                        <span class="text-slate-400">{{ param.name }}:</span>
                        {{ param.value
                        }}{{ param.unit ? ` ${param.unit}` : '' }}
                      </div>
                    </template>
                    <div v-else class="text-[11px] text-slate-300">—</div>
                    <div
                      v-if="row.inB.notes"
                      class="text-[10px] text-slate-400"
                    >
                      {{ t('notes') }}: {{ row.inB.notes }}
                    </div>
                  </div>
                </div>
                <div
                  v-else
                  class="grid min-h-[2.75rem] place-items-center rounded-md border border-dashed border-slate-200 text-xs text-slate-300"
                >
                  {{ t('not_in_this_revision') }}
                </div>
              </template>
            </div>
          </div>
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
  return (
    props.detail.subProducts.find((sp) => sp.id === scope.value)?.revisions ??
    []
  );
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

const labelA = computed(
  () => scopeRevisions.value.find((r) => r.id === aId.value)?.label ?? '',
);
const labelB = computed(
  () => scopeRevisions.value.find((r) => r.id === bId.value)?.label ?? '',
);

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
  image: string | null;
  revA: SubProductRevision | null;
  revB: SubProductRevision | null;
  status: CompareStatus | null; // null in single mode
  same: boolean | null; // null in single mode
}

const productRows = computed<ProductRow[] | null>(() => {
  if (scope.value !== 'product' || aId.value == null) return null;
  const setA = membershipMap.value.get(aId.value) ?? new Set<number>();
  const setB =
    bId.value != null
      ? (membershipMap.value.get(bId.value) ?? new Set<number>())
      : null;
  const rows: ProductRow[] = [];
  for (const sp of props.detail.subProducts) {
    const revA = sp.revisions.find((r) => setA.has(r.id)) ?? null;
    const revB = setB
      ? (sp.revisions.find((r) => setB.has(r.id)) ?? null)
      : null;
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
      notify.showToast(
        translateApiError(err, { t, te }, 'errors.load_parts_failed'),
        'error',
      );
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
  const filtered =
    isSingle.value || statusFilter.value === 'all'
      ? rows
      : rows.filter((r) => r.status === statusFilter.value);
  // Identical first, then changed-in-both, then only-in-one-side last.
  return [...filtered].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status),
  );
});

// ── Card helpers ─────────────────────────────────────────────────────────────

/** Sort order shared by both scopes: identical rows first, then rows changed
 *  in both revisions, then rows only present in one revision (added/removed). */
function statusRank(status: CompareStatus | null): number {
  switch (status) {
    case 'unchanged':
      return 0;
    case 'changed':
      return 1;
    case 'added':
    case 'removed':
      return 2;
    default:
      return 0; // single mode — nothing to diff, order doesn't matter
  }
}

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

function qtyDelta(row: ComparePartRow): string {
  if (isSingle.value || !row.inA || !row.inB) return '';
  const d = Number(row.inB.quantity) - Number(row.inA.quantity);
  if (Number.isNaN(d) || d === 0) return '';
  return d > 0 ? `+${d}` : `${d}`;
}

/** Whether a part row is identical across A/B (null in single mode, nothing to diff). */
function partSame(row: ComparePartRow): boolean | null {
  if (isSingle.value) return null;
  return row.status === 'unchanged';
}

/** Background for a single side's block: neutral when identical (or single mode,
 *  nothing to diff), a light red wash when the two sides differ. The status column
 *  between the two sides is left unstyled, so red only marks the two side blocks
 *  themselves — not the gap between them. */
function sideAccentClass(same: boolean | null): string {
  return same === false ? 'bg-red-50/40' : '';
}

/** Sign shown inside the small status dot next to a differing row. */
function statusSign(status: CompareStatus | null): string {
  if (!status) return '';
  return (
    { added: '+', removed: '−', changed: '~', unchanged: '' }[status] ?? ''
  );
}
</script>
