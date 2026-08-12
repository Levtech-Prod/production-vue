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
      >
        <template #position="{ part }">
          <span class="text-slate-500">{{ mountPositionOf(part.id) }}</span>
        </template>
      </PartsTable>

      <!-- Main product BOM, empty: same treatment as the Documents panel —
           header stays, just a centered text line where the table would be. -->
      <div
        v-else-if="isEmptyProductBom"
        class="py-4 text-center text-sm text-slate-400"
      >
        {{ t('no_bom_parts') }}
      </div>

      <!-- Main product BOM: every part across all linked sub-products,
           flattened into a single, uncategorized table. -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-blue-50 text-xs uppercase text-black">
            <tr>
              <th class="w-px px-4 py-2"></th>
              <th class="w-px whitespace-nowrap px-3 py-2">{{ t('sku') }}</th>
              <th class="w-48 px-3 py-2">{{ t('name') }}</th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('price_per_piece') }}
              </th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('quantity') }}
              </th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('mount_position') }}
              </th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('location') }}
              </th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="(part, i) in flatParts"
              :key="`${part.id}-${i}`"
              class="border-t border-slate-100 even:bg-slate-50 transition-colors hover:bg-slate-200"
            >
              <td class="px-4 py-2">
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
              <td
                class="w-px whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500"
              >
                {{ part.code }}
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2 text-slate-700">
                {{ part.name }}
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2 text-slate-700">
                {{ catalogById.get(part.id)?.pricePerPiece ?? '—' }}
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2">
                <span class="font-semibold">{{ part.quantity }}</span>
                <span class="text-slate-400"> {{ part.unit || '' }}</span>
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2 text-slate-500">
                {{ part.mountPosition || '—' }}
              </td>
              <td class="w-px whitespace-nowrap px-3 py-2 text-slate-500">
                {{ catalogById.get(part.id)?.location || '—' }}
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

// Mount position lives on the BOM line, not on the catalog part the table
// rows are built from, so it is looked up from the revision's own payload.
function mountPositionOf(partId: number): string {
  return props.parts.find((p) => p.id === partId)?.mountPosition || '—';
}

// The main-product BOM API returns each part's quantity and mount position,
// but not its location or price; look those up from the shared catalog by id.
// A part used by two sub-products appears twice, hence the index in the row
// key — part id alone is not unique in this flattened list.
const partsStore = usePartsStore();
const catalogById = computed(() => {
  const m = new Map<number, Part>();
  for (const p of partsStore.parts) m.set(p.id, p);
  return m;
});

// Main-product BOM view: parts from every linked sub-product, flattened into
// a single uncategorized list (no per-sub-product grouping/header rows).
const flatParts = computed(() => props.bom.flatMap((sp) => sp.parts));

// An empty product BOM skips the table (and its column headers) in favor of
// a plain centered message, matching how DocumentsPanel shows its empty state.
const isEmptyProductBom = computed(
  () => props.mode === 'product' && flatParts.value.length === 0,
);
</script>
