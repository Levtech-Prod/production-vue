<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 border-b border-slate-100 px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <h3 class="shrink-0 font-semibold text-slate-700">
            {{ t('bom_title') }}
          </h3>
          <span
            v-if="headerChip"
            class="min-w-0 truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
            :title="headerChip"
          >
            {{ headerChip }}
          </span>
        </div>
        <button
          v-if="canExport"
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:pointer-events-none disabled:opacity-60"
          :title="t('export_bom_pdf')"
          :disabled="exporting"
          @click="exportPdf"
        >
          <FileDown class="h-3.5 w-3.5" />
          {{ exporting ? t('exporting') : t('export_pdf') }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <div v-if="loading" class="py-8 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </div>

      <!-- Parts of a single sub-product revision: reuse the parts table. -->
      <PartsTable
        v-else-if="mode === 'subRev'"
        :parts="partRows"
        :empty-text="t('no_parts_in_revision')"
        :expanded-part-ids="expandedPartIds"
        dense
        sticky-header
      >
        <!-- Filling these slots is what makes PartsTable render the columns
             at all (see its hasQty / hasPosition). -->
        <template #qty="{ part }">
          <span class="whitespace-nowrap">
            <span class="font-semibold text-slate-700">
              {{ revisionPartOf(part.id)?.quantity ?? '—' }}
            </span>
            <span class="text-slate-400">
              {{ revisionPartOf(part.id)?.unit || '' }}</span
            >
          </span>
        </template>
        <template #position="{ part }">
          <span class="text-slate-500">{{
            revisionPartOf(part.id)?.mountPosition || '—'
          }}</span>
        </template>
        <template #notes="{ part }">
          <span class="text-slate-500">{{
            revisionPartOf(part.id)?.notes || '—'
          }}</span>
        </template>
        <template v-if="revId != null" #actions="{ part }">
          <div class="flex items-center justify-center">
            <button
              v-if="altParts.hasAlternate(revId, part.id)"
              type="button"
              class="inline-flex items-center gap-1 rounded-lg px-1.5 py-1"
              :class="
                expandedPartIds.has(part.id)
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-slate-400 hover:bg-blue-50 hover:text-blue-600'
              "
              :title="t('view_alternative')"
              @click="toggleExpanded(part.id)"
            >
              <Link2 class="h-4 w-4" />
              <span
                class="h-1.5 w-1.5 rounded-full"
                :class="
                  altParts.alternateInUse(revId, part.id)
                    ? 'bg-emerald-500'
                    : 'bg-blue-500'
                "
              ></span>
            </button>
          </div>
        </template>
        <template v-if="revId != null" #expanded="{ part }">
          <AlternativesPanel
            :alternate="altParts.alternateFor(revId, part.id)"
            :in-use="altParts.alternateInUse(revId, part.id)"
            :quantity="revisionPartOf(part.id)?.quantity"
            :unit="revisionPartOf(part.id)?.unit"
            :mount-position="revisionPartOf(part.id)?.mountPosition"
            :notes="revisionPartOf(part.id)?.notes"
            :editable="false"
          />
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
      <div v-else>
        <table class="w-full text-left text-sm">
          <thead class="table-head sticky top-0 z-10 text-xs">
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
              <th class="w-px whitespace-nowrap px-3 py-2">{{ t('notes') }}</th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('location') }}
              </th>
              <th class="w-px px-3 py-2"></th>
            </tr>
          </thead>

          <tbody>
            <template v-for="(part, i) in flatParts" :key="`${part.id}-${i}`">
              <tr
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
                  {{ part.notes || '—' }}
                </td>
                <td class="w-px whitespace-nowrap px-3 py-2 text-slate-500">
                  {{ catalogById.get(part.id)?.location || '—' }}
                </td>
                <td class="w-px px-3 py-2">
                  <button
                    v-if="
                      altParts.hasAlternate(part.subProductRevisionId, part.id)
                    "
                    type="button"
                    class="inline-flex items-center gap-1 rounded-lg px-1.5 py-1"
                    :class="
                      expandedFlatKeys.has(`${part.id}-${i}`)
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-slate-400 hover:bg-blue-50 hover:text-blue-600'
                    "
                    :title="t('view_alternative')"
                    @click="toggleFlatExpanded(`${part.id}-${i}`)"
                  >
                    <Link2 class="h-4 w-4" />
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      :class="
                        altParts.alternateInUse(
                          part.subProductRevisionId,
                          part.id,
                        )
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                      "
                    ></span>
                  </button>
                </td>
              </tr>
              <tr v-if="expandedFlatKeys.has(`${part.id}-${i}`)">
                <td :colspan="FLAT_COLUMNS" class="p-0">
                  <AlternativesPanel
                    :alternate="
                      altParts.alternateFor(part.subProductRevisionId, part.id)
                    "
                    :in-use="
                      altParts.alternateInUse(
                        part.subProductRevisionId,
                        part.id,
                      )
                    "
                    :quantity="part.quantity"
                    :unit="part.unit"
                    :mount-position="part.mountPosition"
                    :notes="part.notes"
                    :editable="false"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { FileDown, Link2 } from 'lucide-vue-next';
import PartsTable from '../../../parts/PartsTable.vue';
import AlternativesPanel from './AlternativesPanel.vue';
import { useRevisionPartRows } from './composables/useRevisionPartRows.ts';
import { useBomPdfExport } from './composables/useBomPdfExport.ts';
import { usePartsStore } from '../../../../stores/partsStore.ts';
import type { UseAlternativeParts } from './composables/useAlternativeParts.ts';
import type { Part } from '../../../../types/parts.ts';
import type {
  BomSubProduct,
  RevisionPart,
} from '../../../../types/products.ts';

const props = defineProps<{
  mode: 'product' | 'subRev';
  /** Titles the exported PDF and seeds its suggested file name. */
  productName: string;
  // Only meaningful in 'subRev' mode — the product-level flattened view below
  // carries its own subProductRevisionId per row (see flatParts) instead.
  spId?: number;
  revId?: number;
  bom: BomSubProduct[];
  parts: RevisionPart[];
  loading: boolean;
  headerChip?: string;
  altParts: UseAlternativeParts;
}>();

const emit = defineEmits<{ select: [{ spId: number; spRevId: number }] }>();

const { t } = useI18n();

// Sub-product revision parts joined with the catalog so the table shows
// category, location and parameters — same rows as the editable parts panel.
// (Also loads the catalog on mount, which the main-product view reuses below.)
const { rows: partRows } = useRevisionPartRows(toRef(props, 'parts'));

// Quantity, mount position and notes live on the BOM line, not on the catalog
// part the table rows are built from, so they are looked up from the
// revision's own payload.
function revisionPartOf(partId: number): RevisionPart | undefined {
  return props.parts.find((p) => p.id === partId);
}

// Sets rather than single ids: every part with an alternative opens by default.
const expandedPartIds = ref<Set<number>>(new Set());
function toggleExpanded(partId: number) {
  const next = new Set(expandedPartIds.value);
  if (next.has(partId)) next.delete(partId);
  else next.add(partId);
  expandedPartIds.value = next;
}

// Not built on PartsTable, so it keys its own expanded rows — part id alone
// won't do, since the same part can appear via two sub-products.
const expandedFlatKeys = ref<Set<string>>(new Set());
function toggleFlatExpanded(key: string) {
  const next = new Set(expandedFlatKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedFlatKeys.value = next;
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
// Each row keeps its own subProductRevisionId — alternative links are scoped
// per REVISION (see migration 021), so a flattened row still needs to know
// which revision it came from.
const flatParts = computed(() =>
  props.bom.flatMap((sp) =>
    sp.parts.map((part) => ({
      ...part,
      subProductRevisionId: sp.subProductRevisionId,
    })),
  ),
);

// Drives the expanded row's colspan, so it must track the header above.
const FLAT_COLUMNS = 9;

// An empty product BOM skips the table (and its column headers) in favor of
// a plain centered message, matching how DocumentsPanel shows its empty state.
const isEmptyProductBom = computed(
  () => props.mode === 'product' && flatParts.value.length === 0,
);

// Export covers the flattened main-product BOM only: the sub-product revision
// view is the parts table, which has its own columns and its own owner.
const canExport = computed(
  () =>
    props.mode === 'product' && !props.loading && flatParts.value.length > 0,
);

// In 'product' mode headerChip is the product revision's label (see
// useBomAndParts.bomHeaderChip), which is exactly what the export wants —
// and canExport already restricts this to that mode.
const { exporting, exportPdf } = useBomPdfExport(() => ({
  productName: props.productName,
  revisionLabel: props.headerChip,
  rows: flatParts.value,
}));

// Seeded, not computed: a row the user collapses by hand stays collapsed.
// `linkVersion` is what fires this when a fetch resolves.
watch(
  [() => props.revId, partRows, () => props.altParts.linkVersion],
  () => {
    if (props.revId == null) return;
    const seeded = new Set(expandedPartIds.value);
    for (const part of partRows.value) {
      if (props.altParts.hasAlternate(props.revId, part.id))
        seeded.add(part.id);
    }
    expandedPartIds.value = seeded;
  },
  { immediate: true },
);

watch(
  [flatParts, () => props.altParts.linkVersion],
  () => {
    const seeded = new Set(expandedFlatKeys.value);
    flatParts.value.forEach((part, i) => {
      if (props.altParts.hasAlternate(part.subProductRevisionId, part.id)) {
        seeded.add(`${part.id}-${i}`);
      }
    });
    expandedFlatKeys.value = seeded;
  },
  { immediate: true },
);
</script>
