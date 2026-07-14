<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 border-b border-slate-100 px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="min-w-0 truncate font-semibold text-slate-700">
          {{ t('bom_title') }}
        </h3>
        <span
          v-if="headerChip"
          class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
        >
          {{ headerChip }}
        </span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="loading" class="py-8 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </div>

      <!-- Parts of a single sub-product revision: reuse the parts table. -->
      <PartsTable
        v-else-if="mode === 'subRev'"
        :parts="partRows"
        :empty-text="t('no_parts_in_revision')"
      />

      <!-- Main product BOM: each linked sub-product, with its parts below. -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <!-- One main header: image + name columns have no label; the
               part-only fields (SKU, quantity, location, price) are labelled
               and packed to the left, with a flexible spacer on the right. -->
          <thead class="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th class="w-px px-4 py-2"></th>
              <th class="w-48 px-3 py-2"></th>
              <th class="w-px whitespace-nowrap px-3 py-2">{{ t('sku') }}</th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('quantity') }}
              </th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('location') }}
              </th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('price_per_piece') }}
              </th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>

          <tbody v-if="bom.length === 0">
            <tr>
              <td colspan="7" class="py-12 text-center text-sm text-slate-400">
                {{ t('no_linked_sub_products') }}
              </td>
            </tr>
          </tbody>

          <tbody
            v-for="sp in bom"
            :key="sp.subProductId"
            class="border-t border-slate-100"
          >
            <!-- Sub-product row: image, then name with SKU under it and the
                 revision label next to the name (click to open its parts). -->
            <tr
              class="cursor-pointer bg-slate-100 transition-colors hover:bg-slate-200/70"
              :title="t('view_sub_product_parts')"
              @click="
                emit('select', {
                  spId: sp.subProductId,
                  spRevId: sp.subProductRevisionId,
                })
              "
            >
              <td class="px-4 py-2.5">
                <img
                  v-if="sp.subProductImage"
                  :src="sp.subProductImage"
                  class="h-10 w-10 rounded-lg border border-slate-200 object-cover"
                  :alt="sp.subProductName"
                />
                <div
                  v-else
                  class="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-slate-200 text-slate-400"
                >
                  ▣
                </div>
              </td>
              <td class="px-3 py-2.5" colspan="6">
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-slate-800">{{
                    sp.subProductName
                  }}</span>
                  <span
                    class="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-slate-500"
                  >
                    {{ sp.subProductRevisionLabel }}
                  </span>
                </div>
                <div class="font-mono text-xs text-slate-500">
                  {{ sp.subProductSku }}
                </div>
              </td>
            </tr>

            <!-- Parts of this sub-product -->
            <tr v-if="sp.parts.length === 0">
              <td></td>
              <td colspan="6" class="px-3 py-2 text-xs text-slate-400">
                {{ t('no_bom_parts') }}
              </td>
            </tr>
            <tr
              v-for="part in sp.parts"
              v-else
              :key="part.id"
              class="border-t border-slate-50"
            >
              <td class="px-4 py-2 pl-8">
                <img
                  v-if="part.image"
                  :src="part.image"
                  class="h-8 w-8 rounded-md border border-slate-200 object-cover"
                  :alt="part.name"
                />
                <div
                  v-else
                  class="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-300"
                >
                  ▣
                </div>
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2 text-slate-700">
                {{ part.name }}
              </td>
              <td
                class="w-px whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500"
              >
                {{ part.code }}
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2">
                <span class="font-semibold">{{ part.quantity }}</span>
                <span class="text-slate-400"> {{ part.unit || '' }}</span>
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2 text-slate-500">
                {{ catalogById.get(part.id)?.location || '—' }}
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2 text-slate-700">
                {{ catalogById.get(part.id)?.pricePerPiece ?? '—' }}
              </td>
              <td class="px-3 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import PartsTable from '../../../parts/PartsTable.vue';
import { useRevisionPartRows } from './composables/useRevisionPartRows.ts';
import { usePartsStore } from '../../../../stores/partsStore.ts';
import type { Part } from '../../../../types/parts.ts';
import type {
  BomSubProduct,
  RevisionPart,
} from '../../../../types/products.ts';

const props = defineProps<{
  mode: 'product' | 'subRev';
  bom: BomSubProduct[];
  parts: RevisionPart[];
  loading: boolean;
  headerChip?: string;
}>();

const emit = defineEmits<{ select: [{ spId: number; spRevId: number }] }>();

const { t } = useI18n();

// Sub-product revision parts joined with the catalog so the table shows
// category, location and parameters — same rows as the editable parts panel.
// (Also loads the catalog on mount, which the main-product view reuses below.)
const { rows: partRows } = useRevisionPartRows(toRef(props, 'parts'));

// The main-product BOM API returns each part's quantity but not its location
// or price; look those up from the shared catalog by part id.
const partsStore = usePartsStore();
const catalogById = computed(() => {
  const m = new Map<number, Part>();
  for (const p of partsStore.parts) m.set(p.id, p);
  return m;
});
</script>
