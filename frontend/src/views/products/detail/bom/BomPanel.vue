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
        :expanded-part-ids="expandedPartIds"
        dense
      >
        <!-- Read-only counterparts of the editable panel's inputs. Filling the
             slot is what makes PartsTable render the column at all (see its
             hasQty / hasPosition), so without this the BOM view listed parts
             without ever saying how many of each the revision needs. -->
        <template #qty="{ part }">
          <span class="whitespace-nowrap">
            <span class="font-semibold text-slate-700">
              {{ revisionPartOf(part.id)?.quantity ?? '—' }}
            </span>
            <span class="text-slate-400"> {{ revisionPartOf(part.id)?.unit || '' }}</span>
          </span>
        </template>
        <template #position="{ part }">
          <span class="text-slate-500">{{ mountPositionOf(part.id) }}</span>
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
                :class="altParts.alternateInUse(revId, part.id) ? 'bg-emerald-500' : 'bg-blue-500'"
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
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="table-head text-xs">
            <tr>
              <th class="w-px px-4 py-2"></th>
              <th class="w-px whitespace-nowrap px-3 py-2">{{ t('sku') }}</th>
              <th class="w-48 px-3 py-2">{{ t('name') }}</th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('price_per_piece') }}
              </th>
              <th class="w-px whitespace-nowrap px-3 py-2">
                {{ t('total_quantity') }}
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
                <!-- Stock on hand, not a BOM figure: the BOM payload carries
                     quantity and mount position but not stock, so this comes
                     from the shared catalogue like price and location do. -->
                <td class="w-px whitespace-nowrap px-3 py-2 text-slate-500">
                  {{
                    catalogById.get(part.id)
                      ? Math.round(Number(catalogById.get(part.id)?.totalQuantity ?? 0))
                      : '—'
                  }}
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
                <td class="w-px px-3 py-2">
                  <button
                    v-if="altParts.hasAlternate(part.subProductRevisionId, part.id)"
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
                        altParts.alternateInUse(part.subProductRevisionId, part.id)
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
                    :alternate="altParts.alternateFor(part.subProductRevisionId, part.id)"
                    :in-use="altParts.alternateInUse(part.subProductRevisionId, part.id)"
                    :quantity="part.quantity"
                    :unit="part.unit"
                    :mount-position="part.mountPosition"
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
import { Link2 } from 'lucide-vue-next';
import PartsTable from '../../../parts/PartsTable.vue';
import AlternativesPanel from './AlternativesPanel.vue';
import { useRevisionPartRows } from './composables/useRevisionPartRows.ts';
import { usePartsStore } from '../../../../stores/partsStore.ts';
import type { UseAlternativeParts } from './composables/useAlternativeParts.ts';
import type { Part } from '../../../../types/parts.ts';
import type {
  BomSubProduct,
  RevisionPart,
} from '../../../../types/products.ts';

const props = defineProps<{
  mode: 'product' | 'subRev';
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

// Mount position and quantity live on the BOM line, not on the catalog part
// the table rows are built from, so they are looked up from the revision's
// own payload.
function revisionPartOf(partId: number): RevisionPart | undefined {
  return props.parts.find((p) => p.id === partId);
}

function mountPositionOf(partId: number): string {
  return revisionPartOf(partId)?.mountPosition || '—';
}

// View-only expand state — same PartsTable#expanded mechanism as the editable
// panel, just with no add/remove controls (see AlternativesPanel
// :editable="false" above and below). Sets rather than single ids because
// every part that has an alternate opens by default.
const expandedPartIds = ref<Set<number>>(new Set());
function toggleExpanded(partId: number) {
  const next = new Set(expandedPartIds.value);
  if (next.has(partId)) next.delete(partId);
  else next.add(partId);
  expandedPartIds.value = next;
}

// Product-level flattened table isn't built on PartsTable, so it tracks its
// own expanded rows by the same `${part.id}-${i}` key used for v-for/:key —
// part id alone can't key it since the same part may appear via two
// sub-products.
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
    sp.parts.map((part) => ({ ...part, subProductRevisionId: sp.subProductRevisionId })),
  ),
);

// Columns in the flattened table above: thumbnail, code, name, price, stock,
// quantity, mount position, location, and the alternatives toggle. Drives the
// expanded row's colspan, so it has to be kept in step with the header — the
// same reason PartsTable keeps its own FIXED_COLUMNS.
const FLAT_COLUMNS = 9;

// An empty product BOM skips the table (and its column headers) in favor of
// a plain centered message, matching how DocumentsPanel shows its empty state.
const isEmptyProductBom = computed(
  () => props.mode === 'product' && flatParts.value.length === 0,
);

// Auto-expand: a part that has an alternate opens by default in both modes,
// so the substitution is visible without hunting for it. Seeded rather than
// computed outright — once the user collapses a row by hand, that choice
// stands until the underlying rows or links change. `linkVersion` is what
// makes this fire when a fetch resolves (see useAlternativeParts).
watch(
  [() => props.revId, partRows, () => props.altParts.linkVersion],
  () => {
    if (props.revId == null) return;
    const seeded = new Set(expandedPartIds.value);
    for (const part of partRows.value) {
      if (props.altParts.hasAlternate(props.revId, part.id)) seeded.add(part.id);
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
