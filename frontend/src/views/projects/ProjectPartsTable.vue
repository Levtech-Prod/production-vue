<template>
  <div class="card flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
      <div class="relative max-w-xs flex-1">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <input
          v-model="partSearch"
          class="input !pl-9"
          :placeholder="t('search_project_parts_placeholder')"
        />
      </div>

      <span class="text-sm text-slate-400">
        {{ loading ? t('loading') : `${sortedRows.length} / ${rows.length}` }}
      </span>

      <!-- Recalculate only makes sense once there are frozen rows to reseed;
           a draft is already computed live from today's stock on every fetch
           (§5.3), so there is nothing here for it to do. -->
      <button
        v-if="!payload.draft"
        type="button"
        class="btn-secondary ml-auto inline-flex items-center gap-2"
        :disabled="recalculating || rows.length === 0"
        @click="recalculateConfirmOpen = true"
      >
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': recalculating }" />
        {{ t('recalculate_from_stock') }}
      </button>
    </div>

    <p v-if="payload.draft" class="shrink-0 bg-amber-50 px-4 py-2 text-sm text-amber-700">
      {{ t('project_draft_notice') }}
    </p>

    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full text-left text-sm">
        <thead class="table-head sticky top-0 z-10 text-xs">
          <tr>
            <th
              v-for="col in COLUMNS"
              :key="col.key"
              class="cursor-pointer select-none px-4 py-2 hover:bg-blue-200"
              @click="toggleSort(col.key)"
            >
              <span class="inline-flex items-center gap-1">
                {{ t(col.labelKey) }}
                <ChevronUp
                  v-if="sortKey === col.key && sortDir === 'asc'"
                  class="h-3.5 w-3.5"
                />
                <ChevronDown
                  v-else-if="sortKey === col.key && sortDir === 'desc'"
                  class="h-3.5 w-3.5"
                />
                <ChevronsUpDown v-else class="h-3.5 w-3.5 text-blue-400" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && sortedRows.length === 0">
            <td :colspan="COLUMNS.length" class="py-12 text-center text-sm text-slate-400">
              {{ t('no_project_parts_msg') }}
            </td>
          </tr>
          <tr
            v-for="row in sortedRows"
            :key="row.part.id"
            class="border-t border-slate-100"
            :class="row.stockShortfall ? 'bg-amber-50' : 'even:bg-slate-50'"
          >
            <td class="px-4 py-2 font-semibold">
              <span class="inline-flex items-center gap-1.5">
                {{ row.part.name }}
                <TriangleAlert
                  v-if="row.stockShortfall"
                  class="h-3.5 w-3.5 shrink-0 text-amber-600"
                  :title="t('stock_shortfall_warning')"
                />
              </span>
            </td>
            <td class="px-4 py-2 font-mono text-xs text-slate-600">{{ row.part.code }}</td>
            <td class="px-4 py-2" :title="productsBreakdown(row)">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="product in row.products"
                  :key="product.projectProductId"
                  class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {{ product.sku
                  }}<span v-if="hasDuplicateProduct(row, product)" class="text-slate-400">
                    {{ ' ' + product.revisionLabel }}</span
                  >
                </span>
              </div>
            </td>
            <td class="px-4 py-2 tabular-nums">{{ row.requiredQty }}</td>
            <td class="px-4 py-2 tabular-nums">{{ row.availableQty }}</td>
            <td class="px-4 py-2 tabular-nums">{{ row.reservedQty }}</td>
            <td class="px-4 py-2">
              <input
                type="number"
                min="0"
                step="1"
                class="input-cell w-20 tabular-nums"
                :value="displayedMissing(row)"
                :disabled="payload.draft || row.id === null"
                @keydown="blockNonIntegerKeys"
                @input="onMissingInput(row, $event)"
                @blur="flushMissing(row)"
              />
            </td>
            <td class="px-4 py-2 tabular-nums text-slate-500">{{ row.orderedQty }}</td>
            <td class="px-4 py-2 tabular-nums text-slate-500">{{ row.receivedQty }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ConfirmModal
      :visible="recalculateConfirmOpen"
      :title="t('recalculate_from_stock')"
      :message="recalculateConfirmMessage"
      :confirm-text="t('recalculate_from_stock')"
      variant="primary"
      :loading="recalculating"
      @confirm="confirmRecalculate"
      @cancel="recalculateConfirmOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, ChevronUp, ChevronsUpDown, RefreshCw, Search, TriangleAlert } from 'lucide-vue-next';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import { useScopedCache } from '../../composables/useScopedCache.ts';
import { useTableSort } from '../../composables/useTableSort.ts';
import { projectsApi } from '../../api/projectsAPI.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { blockNonIntegerKeys } from '../../utils/numberInput.ts';
import type { ProjectPartRow, ProjectPartRowProduct, ProjectPartsPayload } from '../../types/projects.ts';

/**
 * The bottom table on the Projects page (plan §6.4): the flattened BOM for
 * whichever project the board has selected. `projectId` is only ever passed
 * while something is selected — the parent hides this component entirely
 * otherwise (§6.3), so there is no "nothing selected" state to render here.
 */
const props = defineProps<{ projectId: number }>();

const { t, te } = useI18n();
const notify = useNotificationStore();

const EMPTY_PAYLOAD: ProjectPartsPayload = { draft: false, rows: [] };

const current = computed(() => props.projectId);

// Cached per project (§6.3): switching back to a project already looked at
// this session is instant. `invalidateAndRefresh` / `dropCacheKey` below are
// what keep that cache from showing a BOM a write has since moved past.
const { data: payload, loading, isCurrent, load, invalidateAndRefresh, dropCacheKey } =
  useScopedCache<number, ProjectPartsPayload>({
    current,
    keyFor: (id) => String(id),
    fetcher: async (id) => (await projectsApi.getParts(id)).data,
    empty: EMPTY_PAYLOAD,
  });

const rows = computed(() => payload.value.rows);

watch(() => props.projectId, (id) => void load(id), { immediate: true });

/** Called by `ProjectsView` after a write that moves this project's rows but
 *  happens outside this component (editing the project, Start) — the two
 *  writes that can land on a project other than the one on screen, since
 *  their buttons live on every card, not only the selected one. */
function invalidateProject(id: number) {
  if (isCurrent(id)) void invalidateAndRefresh(id);
  else dropCacheKey(String(id));
}

defineExpose({ invalidateProject });

// ---- Search (§6.4 names a category search; widened to part name too, since
//      both answer the same question — "find me this part" — and a search
//      box that only takes one of the two names on the row reads as broken) —
//      client-side, the table's only filter.

const partSearch = ref('');

const filteredRows = computed(() => {
  const q = partSearch.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter(
    (row) => row.part.name.toLowerCase().includes(q) || row.part.categoryName.toLowerCase().includes(q),
  );
});

// ---- Sorting ---------------------------------------------------------------

const COLUMNS = [
  { key: 'name', labelKey: 'name' },
  { key: 'code', labelKey: 'code' },
  { key: 'products', labelKey: 'products' },
  { key: 'required', labelKey: 'required_quantity' },
  { key: 'available', labelKey: 'available_quantity' },
  { key: 'reserved', labelKey: 'reserved_quantity' },
  { key: 'missing', labelKey: 'purchase_quantity' },
  { key: 'ordered', labelKey: 'ordered_quantity' },
  { key: 'received', labelKey: 'received_quantity' },
] as const;

const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort(
  () => filteredRows.value,
  {
    name: (row) => row.part.name,
    code: (row) => row.part.code,
    products: (row) => row.products.map((p) => p.sku).join(', '),
    required: (row) => row.requiredQty,
    available: (row) => row.availableQty,
    reserved: (row) => row.reservedQty,
    missing: (row) => row.missingQty,
    ordered: (row) => row.orderedQty,
    received: (row) => row.receivedQty,
  },
);

// ---- Products cell (§5.4) ---------------------------------------------------

/** The revision label only earns its place on the chip when the same
 *  product is pinned to this project more than once — otherwise there is
 *  nothing for it to disambiguate. */
function hasDuplicateProduct(row: ProjectPartRow, product: ProjectPartRowProduct): boolean {
  return row.products.filter((p) => p.productId === product.productId).length > 1;
}

/** "26 = CTRL-100 8 + PSU-200 18" — how `requiredQty` breaks down across the
 *  products that use this part, without a second request (§5.4). */
function productsBreakdown(row: ProjectPartRow): string {
  const terms = row.products.map((p) => `${p.sku} ${p.qtyForProduct}`).join(' + ');
  return `${row.requiredQty} = ${terms}`;
}

// ---- Missing quantity edit (§6.4) ------------------------------------------
//
// A debounced PATCH per row, keyed by `project_parts.id` — only started
// projects have one, which is also why the input is disabled otherwise. The
// value shown while a write is in flight (or about to be) is the locally
// typed one, not the last server value; once the write lands the cache is
// invalidated and the server's row takes back over.

const MISSING_QTY_DEBOUNCE_MS = 500;

const pendingMissingQty = reactive<Record<number, number>>({});
const missingQtyTimers = new Map<number, ReturnType<typeof setTimeout>>();

function displayedMissing(row: ProjectPartRow): number {
  return row.id !== null && row.id in pendingMissingQty ? pendingMissingQty[row.id] : row.missingQty;
}

function onMissingInput(row: ProjectPartRow, event: Event) {
  if (row.id === null) return;
  const projectPartId = row.id;
  const raw = (event.target as HTMLInputElement).value;
  pendingMissingQty[projectPartId] = raw === '' ? 0 : Math.max(0, Math.round(Number(raw)));

  const existing = missingQtyTimers.get(projectPartId);
  if (existing) clearTimeout(existing);
  missingQtyTimers.set(
    projectPartId,
    setTimeout(() => void commitMissing(props.projectId, projectPartId, row.orderedQty), MISSING_QTY_DEBOUNCE_MS),
  );
}

function flushMissing(row: ProjectPartRow) {
  if (row.id === null || !(row.id in pendingMissingQty)) return;
  const projectPartId = row.id;
  const timer = missingQtyTimers.get(projectPartId);
  if (timer) clearTimeout(timer);
  missingQtyTimers.delete(projectPartId);
  void commitMissing(props.projectId, projectPartId, row.orderedQty);
}

async function commitMissing(projectId: number, projectPartId: number, orderedQty: number) {
  missingQtyTimers.delete(projectPartId);
  const raw = pendingMissingQty[projectPartId];
  if (raw === undefined) return;
  // A line can never be made to owe less than it has already bought (§3.3);
  // the API enforces this too (MISSING_QTY_BELOW_ORDERED), this just avoids
  // a round trip for the common case of typing a smaller, still-valid number.
  const missingQty = Math.max(raw, orderedQty);
  try {
    await projectsApi.updatePart(projectId, projectPartId, { missingQty });
    // Awaited before clearing the pending value, so the input never flashes
    // back to the pre-edit number while the refetch is still in flight.
    await invalidateAndRefresh(projectId);
    delete pendingMissingQty[projectPartId];
  } catch (err) {
    delete pendingMissingQty[projectPartId];
    notify.showToast(translateApiError(err, { t, te }, 'errors.save_project_part_failed'), 'error');
  }
}

onBeforeUnmount(() => {
  for (const timer of missingQtyTimers.values()) clearTimeout(timer);
  missingQtyTimers.clear();
});

// ---- Recalculate from stock (§6.4, §5.3) -----------------------------------
//
// The confirm's counts are read straight off the rows already on screen —
// `missingQtyOverridden` is exactly what decides whether a row is eligible,
// so no preview round trip is needed to say so up front.

const recalculateConfirmOpen = ref(false);
const recalculating = ref(false);

const recalculateConfirmMessage = computed(() => {
  const overridden = rows.value.filter((row) => row.missingQtyOverridden).length;
  return t('confirmations.recalculate_project_parts_msg', {
    eligible: rows.value.length - overridden,
    overridden,
  });
});

async function confirmRecalculate() {
  if (recalculating.value) return;
  recalculating.value = true;
  try {
    const { data } = await projectsApi.recalculateParts(props.projectId);
    recalculateConfirmOpen.value = false;
    await invalidateAndRefresh(props.projectId);
    notify.showToast(
      t('success.recalculate_project_parts', {
        changed: data.changed.length,
        skipped: data.skipped.length,
      }),
      'success',
    );
  } catch (err) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.recalculate_project_parts_failed'), 'error');
  } finally {
    recalculating.value = false;
  }
}
</script>
