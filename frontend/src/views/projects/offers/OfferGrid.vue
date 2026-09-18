<template>
  <div class="card flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
      <span class="text-sm text-slate-400">
        {{ loading ? t('loading') : t('to_buy_lines', { n: rows.length }) }}
      </span>

      <button
        type="button"
        class="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        :disabled="!editable || loading"
        @click="companyModalOpen = true"
      >
        <Plus class="h-4 w-4" />
        {{ t('add_offer_company') }}
      </button>
    </div>

    <!-- `useScopedCache` answers a failed fetch with the empty payload, which
         renders as a grid with nothing to buy — indistinguishable from a
         project that genuinely has nothing left. Without this the page's whole
         report of a broken request is a blank table. -->
    <p
      v-if="loadError && !loading"
      class="flex shrink-0 items-center gap-3 bg-red-50 px-4 py-2 text-sm text-red-600"
    >
      {{ loadError }}
      <button type="button" class="font-semibold underline" @click="reload">
        {{ t('retry') }}
      </button>
    </p>

    <p
      v-else-if="!loading && !editable"
      class="shrink-0 bg-slate-50 px-4 py-2 text-sm text-slate-600"
    >
      {{ t('offer_sheet_read_only') }}
    </p>

    <div class="min-h-0 flex-1 overflow-auto">
      <!-- At least as wide as the panel, so a project with no company columns
           yet fills it and shows no scrollbar. The slack goes to the spacer
           column at the end rather than inflating the real ones; once the
           columns outgrow the panel the spacer collapses and the grid scrolls
           sideways, which is what the sticky identity columns are for. -->
      <table class="min-w-full text-left text-sm">
        <thead class="table-head sticky top-0 z-20 text-xs">
          <tr>
            <th
              :ref="(el) => registerHeaderCell('image', el)"
              :style="stickyStyle('image')"
              class="sticky top-0 z-30 bg-blue-100 px-3 py-2"
            >
              {{ t('image') }}
            </th>
            <th
              :ref="(el) => registerHeaderCell('name', el)"
              :style="stickyStyle('name')"
              class="sticky top-0 z-30 cursor-pointer select-none bg-blue-100 px-3 py-2 hover:bg-blue-200"
              @click="sortColumn('name')"
            >
              <div :style="boundsStyle('name')">
                <SortLabel :label="t('name')" sort-key="name" :active-key="sortKey" :dir="sortDir" />
              </div>
            </th>
            <th
              :ref="(el) => registerHeaderCell('code', el)"
              :style="stickyStyle('code')"
              class="sticky top-0 z-30 cursor-pointer select-none bg-blue-100 px-3 py-2 hover:bg-blue-200"
              @click="sortColumn('code')"
            >
              <div :style="boundsStyle('code')">
                <SortLabel :label="t('code')" sort-key="code" :active-key="sortKey" :dir="sortDir" />
              </div>
            </th>
            <th
              :ref="(el) => registerHeaderCell('quantity', el)"
              :style="stickyStyle('quantity')"
              class="sticky top-0 z-30 cursor-pointer select-none bg-blue-100 px-3 py-2 hover:bg-blue-200"
              @click="sortColumn('quantity')"
            >
              <div :style="boundsStyle('quantity')">
                <SortLabel
                  :label="t('purchase_quantity')"
                  sort-key="quantity"
                  :active-key="sortKey"
                  :dir="sortDir"
                />
              </div>
            </th>
            <th class="px-3 py-2">
              <div :style="boundsStyle('reference')">{{ t('reference_price') }}</div>
            </th>

            <th v-for="company in companies" :key="company.id" class="px-3 py-2">
              <div class="flex items-center gap-1" :style="boundsStyle('company')">
                <span
                  class="flex-1 cursor-pointer select-none truncate"
                  :title="company.name"
                  @click="sortColumn(companySortKey(company.id))"
                >
                  <SortLabel
                    :label="company.name"
                    :sort-key="companySortKey(company.id)"
                    :active-key="sortKey"
                    :dir="sortDir"
                  />
                </span>
                <!-- One currency for the column, not for each cell: a supplier
                     quotes a whole sheet in one currency, and a select in every
                     cell would cost more width than the price it sits beside.
                     It is what the column is READ in as well as written in, so
                     switching it restates every price below in that currency. -->
                <select
                  v-model="columnCurrency[company.id]"
                  class="rounded border border-blue-200 bg-white px-1 py-0.5 text-[11px] text-slate-600"
                  :aria-label="t('currency')"
                >
                  <option
                    v-for="c in CURRENCIES"
                    :key="c"
                    :value="c"
                    :disabled="c !== 'EUR' && ronPerEur === null"
                  >
                    {{ c }}
                  </option>
                </select>
                <button
                  v-if="editable"
                  type="button"
                  class="rounded p-0.5 text-blue-500 hover:bg-blue-200 hover:text-red-600"
                  :title="t('remove_offer_company')"
                  @click="openRemoveCompany(company)"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>
            </th>

            <th class="w-full" />
          </tr>
        </thead>

        <tbody>
          <tr v-if="!loading && displayRows.length === 0">
            <td :colspan="6 + companies.length" class="py-12 text-center text-sm text-slate-400">
              {{ t('no_offer_rows_msg') }}
            </td>
          </tr>

          <tr
            v-for="(row, rowIndex) in displayRows"
            :key="row.projectPartId"
            class="border-t border-slate-100"
            :class="rowBg(rowIndex)"
          >
            <td :style="stickyStyle('image')" :class="['sticky z-10 px-3 py-2', rowBg(rowIndex)]">
              <button
                v-if="row.part.image"
                type="button"
                class="block"
                :title="t('view_image')"
                @click="openImagePreview(row)"
              >
                <img
                  :src="row.part.image"
                  class="h-8 w-8 rounded-lg border border-slate-200 object-cover transition-transform hover:scale-105"
                  :alt="row.part.name"
                />
              </button>
              <div
                v-else
                class="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
              >
                ▣
              </div>
            </td>
            <td
              :style="stickyStyle('name')"
              :class="['sticky z-10 px-3 py-2 font-semibold', rowBg(rowIndex)]"
            >
              <div class="truncate" :style="boundsStyle('name')" :title="row.part.name">
                {{ row.part.name }}
              </div>
            </td>
            <td
              :style="stickyStyle('code')"
              :class="['sticky z-10 px-3 py-2 font-mono text-xs text-slate-600', rowBg(rowIndex)]"
            >
              <div class="truncate" :style="boundsStyle('code')" :title="row.part.code">
                {{ row.part.code }}
              </div>
            </td>

            <td
              :style="stickyStyle('quantity')"
              :class="['sticky z-10 px-3 py-2', rowBg(rowIndex)]"
            >
              <div :style="boundsStyle('quantity')">
                <input
                  :ref="(el) => quantity.registerInput(row.part.id, el)"
                  type="number"
                  min="0"
                  step="1"
                  class="input-cell w-20 tabular-nums"
                  :value="quantity.displayed(quantityTarget(row))"
                  :disabled="!editable"
                  @keydown="blockNonIntegerKeys"
                  @input="quantity.onInput(quantityTarget(row), $event)"
                  @blur="quantity.flush(quantityTarget(row))"
                />
                <!-- The basket totals below are over what is still buyable, not
                     over what was bought weeks ago; without this the difference
                     between the two numbers has nowhere to show. -->
                <div
                  v-if="row.orderedQty > 0"
                  class="truncate px-2 text-[11px] text-slate-400"
                  :title="t('less_ordered', { n: row.orderedQty })"
                >
                  {{ t('less_ordered', { n: row.orderedQty }) }}
                </div>
              </div>
            </td>

            <!-- Read-only, and never an offer: greyed, excluded from the best
                 price and from the totals (§6.5). -->
            <td class="px-3 py-2 text-xs text-slate-400">
              <div :style="boundsStyle('reference')">
                <template v-if="row.referencePrice">
                  <div class="truncate tabular-nums">
                    {{ formatPrice(row.referencePrice.pricePerPiece) }} ·
                    {{ t(`reference_source.${row.referencePrice.source}`) }}
                  </div>
                  <div class="truncate" :title="referenceOrigin(row.referencePrice)">
                    {{ referenceOrigin(row.referencePrice) }}
                  </div>
                </template>
                <span v-else>—</span>
              </div>
            </td>

            <td v-for="company in companies" :key="company.id" class="px-3 py-2">
              <div
                class="flex items-center gap-1 rounded-md"
                :style="boundsStyle('company')"
                :class="isBestPrice(row, company.id) ? 'bg-green-100 ring-1 ring-green-400' : ''"
              >
                <!-- A text input, not `type=number`: ↑/↓ have to move between
                     rows, and a number field spends them on its own spinner. -->
                <input
                  :ref="(el) => registerPriceInput(row, company, el)"
                  type="text"
                  inputmode="decimal"
                  data-price-cell="true"
                  class="input-cell w-full min-w-0 text-right tabular-nums"
                  :value="cellText(row, company)"
                  :disabled="!editable"
                  @focus="freezeOrder"
                  @input="onCellInput(row, company, $event)"
                  @blur="onCellBlur(row, company, $event)"
                  @keydown="onCellKeydown($event, rowIndex, company)"
                />
                <span class="pr-1 text-[10px] text-slate-400">
                  {{ columnCurrency[company.id] }}
                </span>
              </div>
            </td>

            <td />
          </tr>
        </tbody>

        <tfoot v-if="companies.length > 0 && displayRows.length > 0">
          <tr class="border-t border-slate-300 text-xs font-medium text-slate-600">
            <td :style="stickyStyle('image')" class="sticky bottom-0 z-30 bg-slate-100 px-3 py-2" />
            <td :style="stickyStyle('name')" class="sticky bottom-0 z-30 bg-slate-100 px-3 py-2">
              <div class="truncate" :style="boundsStyle('name')">{{ t('offer_footer_label') }}</div>
            </td>
            <td :style="stickyStyle('code')" class="sticky bottom-0 z-30 bg-slate-100 px-3 py-2" />
            <td :style="stickyStyle('quantity')" class="sticky bottom-0 z-30 bg-slate-100 px-3 py-2" />
            <td class="sticky bottom-0 z-20 bg-slate-100 px-3 py-2" />
            <td
              v-for="footer in footers"
              :key="footer.companyId"
              class="sticky bottom-0 z-20 bg-slate-100 px-3 py-2"
            >
              <div class="tabular-nums">
                {{ t('offer_coverage', { quoted: footer.quoted, total: rows.length }) }}
              </div>
              <div class="tabular-nums text-slate-800">
                {{ formatPrice(footer.total, footer.currency) }}
              </div>
            </td>

            <td class="sticky bottom-0 z-20 bg-slate-100" />
          </tr>
        </tfoot>
      </table>
    </div>

    <OfferCompanyModal
      :visible="companyModalOpen"
      :used-company-ids="companies.map((c) => c.companyId)"
      :saving="addingCompany"
      :error="addCompanyError"
      @submit="addCompany"
      @close="closeCompanyModal"
    />

    <DeleteConfirmModal
      :target="removeCompanyTarget"
      title-key="remove_offer_company"
      message-key="confirmations.remove_offer_company_msg"
      :label="(company) => company.name"
      :loading="removeCompanyBusy"
      @confirm="confirmRemoveCompany"
      @cancel="cancelRemoveCompany"
    />

    <ImagePreviewModal
      v-model="imagePreviewOpen"
      :image="previewRow?.part.image"
      :title="previewRow?.part.name"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, X } from 'lucide-vue-next';
import SortLabel from '../../../components/SortLabel.vue';
import OfferCompanyModal from './OfferCompanyModal.vue';
import DeleteConfirmModal from '../../../components/notification/DeleteConfirmModal.vue';
import ImagePreviewModal from '../../../components/modal/ImagePreviewModal.vue';
import { useScopedCache } from '../../../composables/useScopedCache.ts';
import { useTableSort, type SortAccessors } from '../../../composables/useTableSort.ts';
import {
  useProjectPartQuantity,
  type QuantityTarget,
} from '../../../composables/useProjectPartQuantity.ts';
import { useConfirmDelete } from '../../../composables/useConfirmDelete.ts';
import { projectOffersApi } from '../../../api/projectOffersAPI.ts';
import { useNotificationStore } from '../../../stores/notificationStore.ts';
import { translateApiError } from '../../../utils/apiError.ts';
import { blockNonIntegerKeys, parseDecimalInput } from '../../../utils/numberInput.ts';
import { formatPrice } from '../../../utils/formatters.ts';
import type { EntryCurrency } from '../../../types/parts.ts';
import type { ProjectBoardCard } from '../../../types/projects.ts';
import type {
  OfferCompanyColumn,
  OfferGrid,
  OfferPriceCell,
  OfferPriceResult,
  OfferRow,
  ReferencePrice,
} from '../../../types/projectOffers.ts';

/**
 * The price grid on the right of the Offer Processing page (§6.5).
 *
 * `projectId` is only ever passed while a project is selected — the parent
 * renders nothing otherwise — so there is no "nothing selected" state here.
 */
const props = defineProps<{ projectId: number }>();

/** The quantity edit can move the project between the board's columns, and the
 *  list on the left shows the counts that say so. */
const emit = defineEmits<{ card: [card: ProjectBoardCard] }>();

const { t, te } = useI18n();
const notify = useNotificationStore();

const CURRENCIES: EntryCurrency[] = ['EUR', 'RON'];
// The empty payload a scope starts from has to carry SOME status, and whichever
// one it carries would read as fact for the length of the first fetch — so
// everything that branches on `editable` is gated on `!loading` as well.
const EMPTY_GRID: OfferGrid = { status: 'started', companies: [], rows: [], ronPerEur: null };

const current = computed(() => props.projectId);

// Behind `useScopedCache` (§6.5) for the same reason the Parts table is:
// switching between projects while comparing quotes is the whole workflow, and
// a slow response must never land on top of a newer selection.
/** Why the sheet is empty, when the reason is a failed request rather than a
 *  project with nothing left to buy. `useScopedCache` deliberately answers a
 *  failure with the empty payload, so the distinction has to be kept here. */
const loadError = ref<string | null>(null);

const { data: grid, loading, load, refresh, patchScope } = useScopedCache<number, OfferGrid>({
  current,
  keyFor: (id) => String(id),
  fetcher: async (id) => {
    try {
      const { data } = await projectOffersApi.getGrid(id);
      loadError.value = null;
      return data;
    } catch (err) {
      loadError.value = translateApiError(err, { t, te }, 'errors.load_offer_grid_failed');
      // Rethrown: the cache must treat this as a failure, drop the entry and
      // show the empty payload. This only adds the reason.
      throw err;
    }
  },
  empty: EMPTY_GRID,
  onData: (data) => adoptColumnCurrencies(data),
});

/** A failed fetch leaves no cache entry, so this genuinely re-reads. */
function reload() {
  loadError.value = null;
  void load(props.projectId);
}

const rows = computed(() => grid.value.rows);
const companies = computed(() => grid.value.companies);
/** A stopped or completed project's sheet is a record of what was quoted, not
 *  something to go on quoting into. */
const editable = computed(() => grid.value.status === 'started');
/** RON per 1 EUR today. Null means the page cannot render RON at all, so the
 *  column currency stays on EUR (`adoptColumnCurrencies`) and the option is
 *  disabled rather than showing prices at a rate nobody has. */
const ronPerEur = computed(() => grid.value.ronPerEur);

/**
 * The row order held still while prices are being typed — see `displayRows`
 * below, which is what reads it.
 *
 * Declared HERE, far from the logic that owns it, because the `immediate`
 * watcher just below clears it on mount: an `immediate` watcher runs during
 * `setup()`, so a `const` declared further down the file is still in its
 * temporal dead zone and touching it throws `ReferenceError` before the
 * component ever mounts. `vue-tsc` cannot see that — it does not know when a
 * callback runs — so the guard is this comment and this position.
 */
const frozenOrder = ref<number[] | null>(null);

watch(
  () => props.projectId,
  (id, previous) => {
    // Anything typed into the project being left is still only in the browser;
    // flushing it here is what makes switching projects mid-column safe.
    if (previous !== undefined) void flushPrices();
    frozenOrder.value = null;
    void load(id);
  },
  { immediate: true },
);

// ---- Column widths and the sticky identity columns (§6.5) ------------------
//
// Columns size to what they hold, between a floor and a cap: a grid of short
// codes should not reserve 140px for them, and one part named like a sentence
// should not push the company columns off the screen. The bounds go on a div
// inside the cell rather than on the cell — in an auto-layout table a `<td>`
// width is a suggestion the browser is free to ignore, while the widest inner
// box is what the column is actually sized from.

const STICKY_COLUMNS = ['image', 'name', 'code', 'quantity'] as const;
type StickyColumn = (typeof STICKY_COLUMNS)[number];
/** The image column is absent on purpose: a fixed thumbnail under a one-word
 *  heading has no content to grow to, so it is left to size itself. */
type BoundedColumn = 'name' | 'code' | 'quantity' | 'reference' | 'company';

const COLUMN_BOUNDS: Record<BoundedColumn, { min: number; max: number }> = {
  name: { min: 150, max: 320 },
  code: { min: 100, max: 190 },
  // Fixed: its content is a whole number in a small box, so there is nothing
  // to grow to, and a purchase column that changes width between projects is
  // one more thing moving under the cursor mid-edit.
  quantity: { min: 110, max: 110 },
  reference: { min: 140, max: 230 },
  // Floored by the company name, its currency select and its remove button,
  // which together outgrow any price the column holds.
  company: { min: 150, max: 240 },
};

function boundsStyle(column: BoundedColumn) {
  const { min, max } = COLUMN_BOUNDS[column];
  return { minWidth: `${min}px`, maxWidth: `${max}px` };
}

// Past three or four companies the grid scrolls sideways, and a price typed
// into the wrong row is worse than no price at all — so the columns that say
// WHICH row this is stay pinned. Quantity is among them because a price is
// only worth reading against the number of pieces it is being quoted for; a
// basket total computed from a figure that has scrolled out of sight is the
// same mistake one column over. `left` has to be a pixel offset, and a column sized from
// its content has no width CSS can add up, so the header cells are measured and
// the offsets are their running total. Starting from the floors keeps the first
// paint aligned, before the observer has reported anything.

const stickyWidths = reactive<Record<StickyColumn, number>>({
  image: 56,
  name: COLUMN_BOUNDS.name.min,
  code: COLUMN_BOUNDS.code.min,
  quantity: COLUMN_BOUNDS.quantity.min,
});

const headerCells = new Map<StickyColumn, HTMLElement>();
let headerObserver: ResizeObserver | null = null;

function measureHeaderCells() {
  // `getBoundingClientRect().width`, not `offsetWidth`: text-derived column
  // widths are fractional, and offsetWidth rounds each one to an integer. The
  // offsets are a RUNNING TOTAL, so those roundings accumulate — measured at
  // ~0.64px by the fourth pinned column, which shows as slivers of the
  // scrolling company columns between the frozen ones.
  for (const [column, el] of headerCells) {
    stickyWidths[column] = el.getBoundingClientRect().width;
  }
}

function registerHeaderCell(column: StickyColumn, el: unknown) {
  const previous = headerCells.get(column);
  // Ref callbacks run on every patch, and a measurement re-renders: without
  // this the observer would be torn down and rebuilt on each pass, each rebuild
  // firing an initial observation of its own.
  if (previous === el) return;
  if (previous) headerObserver?.unobserve(previous);

  if (!(el instanceof HTMLElement)) {
    headerCells.delete(column);
    return;
  }
  headerCells.set(column, el);
  headerObserver ??= new ResizeObserver(measureHeaderCells);
  headerObserver.observe(el);
}

onBeforeUnmount(() => headerObserver?.disconnect());

function stickyStyle(column: StickyColumn) {
  const left = STICKY_COLUMNS.slice(0, STICKY_COLUMNS.indexOf(column)).reduce(
    (sum, earlier) => sum + stickyWidths[earlier],
    0,
  );
  return { left: `${left}px` };
}

/** Sticky cells scroll over the rest of the row, so they cannot be
 *  transparent — they carry their row's stripe themselves. */
function rowBg(index: number): string {
  return index % 2 === 0 ? 'bg-white' : 'bg-slate-50';
}

// ---- Sorting (§6.5) --------------------------------------------------------
//
// The company columns are data, so the accessors are a getter: adding or
// removing a column changes which keys exist while the page is open.

const companySortKey = (offerCompanyId: number) => `company:${offerCompanyId}`;

const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort<OfferRow>(
  () => rows.value,
  () => {
    const accessors: SortAccessors<OfferRow> = {
      name: (row) => row.part.name,
      code: (row) => row.part.code,
      quantity: (row) => row.quantity,
    };
    for (const company of companies.value) {
      // Null, not zero: an absent quote is not "cheap", and `useTableSort`
      // sorts a missing value last in both directions.
      accessors[companySortKey(company.id)] = (row) =>
        row.prices[company.id]?.pricePerPiece ?? null;
    }
    return accessors;
  },
);

/**
 * The rows as rendered: the sort, except while prices are being typed into it.
 *
 * Sorting by a company column and entering prices into that same column is the
 * ordinary way to use this page, and those two fight: each flush rewrites the
 * value the sort reads, so the row just filled in jumps to its new place and
 * every row below it shifts. Vue keys rows by part, so the cursor stays on the
 * right one — but the list moves under the eyes of someone reading down it,
 * which is the condition a price gets typed against the wrong part in. The
 * sticky identity columns exist to prevent exactly that.
 *
 * So the order is frozen while a price cell has focus and settles when focus
 * leaves the grid. Only the ORDER is frozen, never the rows: they are looked
 * up fresh every render, so prices, best-price highlighting and the footer all
 * keep updating in place. Rows that leave the grid drop out, and rows the
 * frozen order has never seen (none today, but a refresh could bring some) go
 * at the end rather than being hidden.
 */
const displayRows = computed(() => {
  const order = frozenOrder.value;
  if (order === null) return sortedRows.value;

  const byId = new Map(sortedRows.value.map((row) => [row.projectPartId, row]));
  const held = order.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    byId.delete(id);
    return [row];
  });
  return [...held, ...byId.values()];
});

function freezeOrder() {
  frozenOrder.value ??= sortedRows.value.map((row) => row.projectPartId);
}

/** Leaving a cell writes it, and releases the frozen order once focus has left
 *  the price columns altogether. `relatedTarget` is where focus is GOING: still
 *  a price cell means the buyer is working down the column and the order has to
 *  hold; anywhere else (or nowhere, on the last Enter) lets it re-sort. */
function onCellBlur(row: OfferRow, company: OfferCompanyColumn, event: FocusEvent) {
  commitCell(row, company);
  const next = event.relatedTarget;
  if (next instanceof HTMLElement && next.dataset.priceCell === 'true') return;
  frozenOrder.value = null;
}

// Clicking a header is an explicit request to reorder, and it must win over a
// freeze the click's own focus change may not have cleared.
function sortColumn(key: string) {
  frozenOrder.value = null;
  toggleSort(key);
}

// ---- Purchase quantity (§6.5) ----------------------------------------------
//
// The same `missing_qty` the Projects page edits, through the same endpoint and
// the same composable — one number shown on two screens.

const quantity = useProjectPartQuantity({
  projectId: () => props.projectId,
  onSaved: (projectId, result) => {
    const { row } = result;
    patchScope(projectId, (currentGrid) => ({
      ...currentGrid,
      // A line quantity brought down to what is already on order has nothing
      // left to buy, so it leaves the grid — the same predicate that put it
      // there (§6.5).
      rows:
        row.missingQty <= row.orderedQty
          ? currentGrid.rows.filter((r) => r.part.id !== row.part.id)
          : currentGrid.rows.map((r) =>
              r.part.id === row.part.id
                ? { ...r, quantity: row.missingQty, orderedQty: row.orderedQty }
                : r,
            ),
    }));
    emit('card', result.card);
  },
  onError: (err) =>
    notify.showToast(translateApiError(err, { t, te }, 'errors.save_project_part_failed'), 'error'),
});

function quantityTarget(row: OfferRow): QuantityTarget {
  return { partId: row.part.id, quantity: row.quantity, orderedQty: row.orderedQty };
}

/** What is still to buy on this line. The basket totals run over this rather
 *  than the whole quantity: a supplier is being asked for what is left, not for
 *  what was ordered from someone else weeks ago. */
function remainingQty(row: OfferRow): number {
  return Math.max(0, row.quantity - row.orderedQty);
}

// ---- Money cells (§6.5) ----------------------------------------------------
//
// Typing is local; a cell joins `pending` when it is left, and `pending` goes
// out as ONE `PUT` a moment later (§6.5: batched on blur, never per keystroke).
// The debounce is what makes arrowing down a column of twenty prices one
// request instead of twenty. `draft` holds the text as typed until the write
// lands, so the cell never flickers back to its old value in between.

const PRICE_FLUSH_MS = 400;

const draft = reactive<Record<string, string>>({});
const pending = new Map<string, OfferPriceCell>();
/** Which project `pending` belongs to — it can outlive the selection that
 *  filled it by as long as the debounce. */
let pendingProjectId: number | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const columnCurrency = reactive<Record<number, EntryCurrency>>({});
const priceInputs = new Map<string, HTMLInputElement>();

const cellKey = (projectPartId: number, offerCompanyId: number) =>
  `${projectPartId}:${offerCompanyId}`;

/** Default a column to the currency its existing quotes were entered in — a
 *  sheet reopened to add three more RON prices should not start in EUR. Only
 *  for columns not already chosen on this screen. */
function adoptColumnCurrencies(data: OfferGrid) {
  for (const company of data.companies) {
    if (company.id in columnCurrency) continue;
    const quoted = data.rows.find((row) => row.prices[company.id]);
    const entered = quoted?.prices[company.id]?.enteredCurrency;
    columnCurrency[company.id] =
      entered === 'RON' && data.ronPerEur !== null ? 'RON' : 'EUR';
  }
}

function registerPriceInput(row: OfferRow, company: OfferCompanyColumn, el: unknown) {
  const key = cellKey(row.projectPartId, company.id);
  if (el instanceof HTMLInputElement) priceInputs.set(key, el);
  else priceInputs.delete(key);
}

/** `price_per_piece` is NUMERIC(12,4); a converted figure is rounded to match
 *  rather than shown to fifteen decimal places. */
function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}

/**
 * One cell's price in the currency its column is set to.
 *
 * A cell entered in that currency shows exactly what was typed — a price read
 * back must be the number the supplier quoted, not a round trip through EUR
 * and back. Anything else is derived from the canonical EUR: at its own frozen
 * rate on the way in, at today's on the way out to RON, which is why a column
 * cannot be switched to RON without one.
 */
function displayAmount(row: OfferRow, company: OfferCompanyColumn): number | null {
  const price = row.prices[company.id];
  if (!price) return null;
  const currency = columnCurrency[company.id];
  if (price.enteredCurrency === currency) return price.enteredAmount;
  if (currency === 'EUR') return round4(price.pricePerPiece);
  const rate = ronPerEur.value;
  return rate === null ? null : round4(price.pricePerPiece * rate);
}

function storedText(row: OfferRow, company: OfferCompanyColumn): string {
  const amount = displayAmount(row, company);
  return amount === null ? '' : String(amount);
}

function cellText(row: OfferRow, company: OfferCompanyColumn): string {
  const key = cellKey(row.projectPartId, company.id);
  return key in draft ? draft[key] : storedText(row, company);
}

function onCellInput(row: OfferRow, company: OfferCompanyColumn, event: Event) {
  draft[cellKey(row.projectPartId, company.id)] = (event.target as HTMLInputElement).value;
}

/** A typed amount, or `null` to clear the cell. `undefined` is "not a price" —
 *  either unreadable or negative, which `parseDecimalInput` allows and a price
 *  does not. The separator conventions live in that helper, because story 13's
 *  pasted column has to read a spreadsheet exactly the way this reads a
 *  keystroke. */
function parseAmount(raw: string): number | null | undefined {
  const value = parseDecimalInput(raw);
  if (value === null || value === undefined) return value;
  return value >= 0 ? value : undefined;
}

function discardDraft(key: string) {
  delete draft[key];
  pending.delete(key);
}

/** Take what was typed into a cell that is being left, if it changed anything.
 *  Zero does NOT clear a cell: a free part is a real quote, and has to stay
 *  distinguishable from no quote (§3.5). */
function commitCell(row: OfferRow, company: OfferCompanyColumn) {
  const key = cellKey(row.projectPartId, company.id);
  if (!(key in draft)) return;

  const amount = parseAmount(draft[key]);
  const currency = columnCurrency[company.id];
  const stored = row.prices[company.id] ?? null;
  const unchanged =
    amount === null
      ? stored === null
      : stored !== null && stored.enteredAmount === amount && stored.enteredCurrency === currency;

  if (amount === undefined || unchanged) {
    discardDraft(key);
    setInputText(key, storedText(row, company));
    // A cell that silently reverts is indistinguishable from one that saved,
    // and reverting is exactly what a SUCCESSFUL no-op edit does — so the
    // unreadable case has to say so or a buyer walks away believing a price
    // they typed is stored.
    if (amount === undefined) notify.showToast(t('errors.invalid_price'), 'error');
    return;
  }

  pending.set(key, {
    offerCompanyId: company.id,
    projectPartId: row.projectPartId,
    amount,
    currency,
  });
  pendingProjectId = props.projectId;
  scheduleFlush();
}

function setInputText(key: string, text: string) {
  const input = priceInputs.get(key);
  if (input) input.value = text;
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushPrices(), PRICE_FLUSH_MS);
}

/** Apply a write's own answer to the cached grid — the canonical EUR of a price
 *  typed in RON is computed on the server and nowhere else, so this is what the
 *  best price and the totals are recomputed from. */
function applyPrices(currentGrid: OfferGrid, results: OfferPriceResult[]): OfferGrid {
  const byPart = new Map<number, OfferPriceResult[]>();
  for (const result of results) {
    byPart.set(result.projectPartId, [...(byPart.get(result.projectPartId) ?? []), result]);
  }
  return {
    ...currentGrid,
    rows: currentGrid.rows.map((row) => {
      const changes = byPart.get(row.projectPartId);
      if (!changes) return row;
      const prices = { ...row.prices };
      for (const change of changes) {
        if (change.price) prices[change.offerCompanyId] = change.price;
        else delete prices[change.offerCompanyId];
      }
      return { ...row, prices };
    }),
  };
}

async function flushPrices() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const projectId = pendingProjectId;
  if (flushing || pending.size === 0 || projectId === null) return;

  const keys = [...pending.keys()];
  const cells = [...pending.values()];
  pending.clear();
  flushing = true;
  try {
    const results = await projectOffersApi.setPrices(projectId, cells);
    patchScope(projectId, (currentGrid) => applyPrices(currentGrid, results));
  } catch (err) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.save_offer_prices_failed'), 'error');
  } finally {
    // The drafts go either way: on success the grid now holds the same values,
    // and on failure the boxes have to stop showing prices nobody stored.
    for (const key of keys) delete draft[key];
    flushing = false;
    if (pending.size > 0) scheduleFlush();
  }
}

onBeforeUnmount(() => {
  if (flushTimer) clearTimeout(flushTimer);
  void flushPrices();
});

// ---- Keyboard entry (§6.5) -------------------------------------------------
//
// A column of prices is otherwise two hundred mouse clicks. Tab is left to the
// browser: the cells of one row are adjacent in the DOM, so it already goes
// across.

function focusCell(rowIndex: number, offerCompanyId: number) {
  const row = displayRows.value[rowIndex];
  if (!row) return;
  priceInputs.get(cellKey(row.projectPartId, offerCompanyId))?.focus();
}

function onCellKeydown(event: KeyboardEvent, rowIndex: number, company: OfferCompanyColumn) {
  const input = event.target as HTMLInputElement;
  if (event.key === 'Escape') {
    const row = displayRows.value[rowIndex];
    if (!row) return;
    const key = cellKey(row.projectPartId, company.id);
    discardDraft(key);
    input.value = storedText(row, company);
    return;
  }

  const step = event.key === 'Enter' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();

  const next = rowIndex + step;
  // Off the end of the column: blur instead, so the last price of a column is
  // committed by the same Enter that would have moved on.
  if (next < 0 || next >= displayRows.value.length) input.blur();
  else focusCell(next, company.id);
}

// ---- Best price (§6.5) -----------------------------------------------------

/** `MIN` over the quoted cells of each row. The reference price is not in
 *  `prices` and so cannot win — it is a hint, not an offer. */
const bestPriceByRow = computed(() => {
  const best = new Map<number, number>();
  for (const row of rows.value) {
    const quoted = Object.values(row.prices).map((price) => price.pricePerPiece);
    if (quoted.length > 0) best.set(row.projectPartId, Math.min(...quoted));
  }
  return best;
});

/** Ties highlight all winners (§6.5) — equality, not a single chosen column. */
function isBestPrice(row: OfferRow, offerCompanyId: number): boolean {
  const price = row.prices[offerCompanyId];
  return price !== undefined && bestPriceByRow.value.get(row.projectPartId) === price.pricePerPiece;
}

// ---- Footer (§6.5) ---------------------------------------------------------
//
// Cheapest per piece is not the buying decision: a supplier who quotes 34 of 40
// parts slightly above another who quotes 9 usually wins the order.

const footers = computed(() =>
  companies.value.map((company) => {
    const quoted = rows.value.filter((row) => row.prices[company.id] !== undefined);
    // Summed in canonical EUR and converted once, not summed over the figures
    // in the cells: a column can hold prices entered in both currencies, and
    // adding those together would total two different kinds of money.
    const totalEur = quoted.reduce(
      (sum, row) => sum + row.prices[company.id].pricePerPiece * remainingQty(row),
      0,
    );
    const currency = columnCurrency[company.id];
    const rate = ronPerEur.value;
    return {
      companyId: company.id,
      quoted: quoted.length,
      currency,
      total: currency === 'RON' && rate !== null ? totalEur * rate : totalEur,
    };
  }),
);

// ---- Columns ---------------------------------------------------------------

const companyModalOpen = ref(false);
const addingCompany = ref(false);
const addCompanyError = ref<string | null>(null);

function closeCompanyModal() {
  companyModalOpen.value = false;
  addCompanyError.value = null;
}

async function addCompany(companyId: number) {
  if (addingCompany.value) return;
  addingCompany.value = true;
  addCompanyError.value = null;
  const projectId = props.projectId;
  try {
    const { data } = await projectOffersApi.addCompany(projectId, companyId);
    patchScope(projectId, (currentGrid) => ({
      ...currentGrid,
      companies: [...currentGrid.companies, data],
    }));
    closeCompanyModal();
  } catch (err) {
    addCompanyError.value = translateApiError(err, { t, te }, 'errors.add_offer_company_failed');
  } finally {
    addingCompany.value = false;
  }
}

const {
  target: removeCompanyTarget,
  busy: removeCompanyBusy,
  open: openRemoveCompany,
  confirm: confirmRemoveCompany,
  cancel: cancelRemoveCompany,
} = useConfirmDelete<OfferCompanyColumn>(async (company) => {
  const projectId = props.projectId;
  try {
    await projectOffersApi.removeCompany(projectId, company.id);
    // Dropping the column takes its prices with it, so the rows are re-read
    // rather than patched — and anything typed into it is now about a column
    // that no longer exists.
    for (const key of [...pending.keys()]) {
      if (key.endsWith(`:${company.id}`)) discardDraft(key);
    }
    await refresh(projectId);
    return true;
  } catch (err) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.remove_offer_company_failed'),
      'error',
    );
    return false;
  }
});

// ---- Reference price hint (§6.5) -------------------------------------------

/** Who quoted or sold it, and when — under the price, which carries the
 *  source. */
function referenceOrigin(reference: ReferencePrice): string {
  return `${reference.company} · ${reference.onDate}`;
}

// ---- Image preview ---------------------------------------------------------

const imagePreviewOpen = ref(false);
const previewRow = ref<OfferRow | null>(null);

function openImagePreview(row: OfferRow) {
  previewRow.value = row;
  imagePreviewOpen.value = true;
}
</script>
