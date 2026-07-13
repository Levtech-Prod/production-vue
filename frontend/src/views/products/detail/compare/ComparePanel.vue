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
          <CompareRevisionBadge side="A" />
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
          <CompareRevisionBadge side="B" />
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
        <div
          v-if="!productRows || productRows.length === 0"
          class="px-4 py-8 text-center text-sm text-slate-400"
        >
          {{ t('no_linked_sub_products') }}
        </div>
        <div v-else>
          <CompareTableHeader
            :is-single="isSingle"
            :label-a="labelA"
            :label-b="labelB"
            :side-template="PRODUCT_SIDE_GRID"
            :columns="productColumns"
          />
          <CompareProductRow
            v-for="row in productRows"
            :key="row.spId"
            :row="row"
            :is-single="isSingle"
            @drill="drillIntoParts"
          />
        </div>
      </template>

      <!-- ── Sub-product revision parts ─────────────────────────────────── -->
      <template v-else>
        <div v-if="partsLoading" class="py-8 text-center text-sm text-slate-400">
          {{ t('loading') }}
        </div>
        <template v-else-if="partsResult">
          <CompareStatusFilterBar
            v-if="!isSingle && partsSummary"
            v-model="statusFilter"
            :filters="statusFilters"
            :summary="partsSummary"
            :total="partsResult.parts.length"
          />

          <div
            v-if="filteredParts.length === 0"
            class="py-8 text-center text-sm text-slate-400"
          >
            {{ t('no_parts_in_revision') }}
          </div>
          <div v-else>
            <CompareTableHeader
              :is-single="isSingle"
              :label-a="labelA"
              :label-b="labelB"
              :side-template="PART_SIDE_GRID"
              :columns="partColumns"
            />
            <ComparePartRow
              v-for="row in filteredParts"
              :key="row.partId"
              :row="row"
              :is-single="isSingle"
            />
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeftRight } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { ProductDetail } from '../../../../types/products.ts';

import CompareRevisionBadge from './CompareRevisionBadge.vue';
import CompareTableHeader from './CompareTableHeader.vue';
import CompareProductRow from './CompareProductRow.vue';
import ComparePartRow from './ComparePartRow.vue';
import CompareStatusFilterBar from './CompareStatusFilterBar.vue';

import { useCompareRevisionSelection } from './composables/useCompareRevisionSelection.ts';
import { useCompareProductRows } from './composables/useCompareProductRows.ts';
import { useCompareParts } from './composables/useCompareParts.ts';
import { PART_SIDE_GRID, PRODUCT_SIDE_GRID } from './compareHelpers.ts';

const props = defineProps<{
  detail: ProductDetail;
  /** Preselected revision for side A when the panel opens in product scope. */
  initialRevId?: number | null;
  /** Bump to invalidate cached parts comparisons (e.g. after editing parts). */
  refreshToken?: number;
}>();

const { t } = useI18n();

// Which two revisions we're comparing (scope + side A/B).
const selection = useCompareRevisionSelection(props);
const { scope, aId, bId, isSingle, scopeRevisions, labelA, labelB, swapSides } = selection;

// What to render for that pair: product-level rows are derived client-side,
// part-level rows come from the server (see useCompareParts for caching).
const { productRows, drillIntoParts } = useCompareProductRows(props, selection);
const { partsResult, partsLoading, partsSummary, statusFilter, statusFilters, filteredParts } =
  useCompareParts(
    scope,
    aId,
    bId,
    isSingle,
    computed(() => props.refreshToken),
  );

const productColumns = computed(() => [
  { label: `${t('name')} / ${t('sku')}` },
  { label: t('linked_revision'), center: true },
]);

const partColumns = computed(() => [
  { label: `${t('name')} / ${t('code')}` },
  { label: t('quantity'), center: true },
  { label: t('parameters') },
]);
</script>
