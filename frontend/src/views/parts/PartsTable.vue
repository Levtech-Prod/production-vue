<template>
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm">
      <thead class="table-head text-xs">
        <tr>
          <th :class="cellPad">{{ t('image') }}</th>
          <th :class="cellPad">{{ t('code') }}</th>
          <th :class="cellPad">{{ t('name') }}</th>
          <th :class="cellPad">{{ t('category') }}</th>
          <th :class="cellPad">{{ t('avg_price_per_piece') }}</th>
          <th :class="cellPad">{{ t('total_quantity') }}</th>
          <th v-if="hasQty" :class="cellPad">{{ t('quantity') }}</th>
          <th v-if="hasPosition" :class="cellPad">{{ t('mount_position') }}</th>
          <th
            v-for="cp in columnParameters"
            :key="cp.id"
            :class="[cellPad, 'cursor-pointer select-none hover:bg-blue-200']"
            @click="toggleSort(cp)"
          >
            <span class="inline-flex items-center gap-1">
              {{ cp.name }}
              <span v-if="cp.unit" class="normal-case text-blue-700/70"
                >({{ cp.unit }})</span
              >
              <ChevronUp
                v-if="sortParameterId === cp.id && sortDir === 'asc'"
                class="h-3.5 w-3.5"
              />
              <ChevronDown
                v-else-if="sortParameterId === cp.id && sortDir === 'desc'"
                class="h-3.5 w-3.5"
              />
              <ChevronsUpDown v-else class="h-3.5 w-3.5 text-blue-400" />
            </span>
          </th>
          <th :class="cellPad">{{ t('other_parameters') }}</th>
          <th :class="cellPad">{{ t('location') }}</th>
          <th v-if="hasActions" :class="cellPad">{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="parts.length === 0">
          <td
            :colspan="columnCount"
            class="py-12 text-center text-sm text-slate-400"
          >
            {{ emptyText || t('no_parts_msg') }}
          </td>
        </tr>
        <template v-for="part in sortedParts" :key="part.id">
          <tr
            class="border-t border-slate-100 transition-colors cursor-pointer"
            :class="
              selectedPartId === part.id
                ? 'bg-blue-50 hover:bg-blue-100'
                : 'even:bg-slate-50 hover:bg-slate-100'
            "
            @click="emit('clickRow', part)"
          >
            <td :class="cellPad">
              <button
                v-if="part.image"
                type="button"
                class="block"
                :title="t('view_image')"
                @click="openImagePreview(part)"
              >
                <img
                  :src="part.image"
                  :class="[thumbSize, 'rounded-lg border border-slate-200 object-cover transition-transform hover:scale-105']"
                  :alt="part.name"
                />
              </button>
              <div
                v-else
                :class="[thumbSize, 'grid place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300']"
              >
                ▣
              </div>
            </td>
            <td :class="[cellPad, 'font-mono text-xs text-slate-600']">
              <div>{{ part.code }}</div>
              <div v-if="part.secondaryCodes?.length" class="mt-0.5 text-[10px] text-slate-400">
                {{ part.secondaryCodes.join(', ') }}
              </div>
            </td>
            <td :class="[cellPad, 'font-semibold']">{{ part.name }}</td>
            <td :class="[cellPad, 'text-slate-500']">{{ part.category.name }}</td>
            <td :class="cellPad">
              {{ formatPrice(part.avgPricePerPiece ?? Number(part.pricePerPiece)) }}
            </td>
            <td :class="[cellPad, 'text-slate-700']">
              {{ Math.round(Number(part.totalQuantity ?? 0)) }}
            </td>
            <td v-if="hasQty" :class="cellPad" @click.stop>
              <slot name="qty" :part="part" />
            </td>
            <td v-if="hasPosition" :class="cellPad" @click.stop>
              <slot name="position" :part="part" />
            </td>
            <td
              v-for="cp in columnParameters"
              :key="cp.id"
              :class="[cellPad, 'text-slate-600']"
            >
              {{ columnValue(part, cp) }}
            </td>
            <td :class="cellPad">
              <div class="flex flex-col gap-1">
                <span
                  v-for="v in otherParameters(part)"
                  :key="v.id"
                  class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {{ v.parameter?.name }}: {{ v.value }}
                </span>
                <span v-if="!otherParameters(part).length" class="text-slate-300"
                  >—</span
                >
              </div>
            </td>
            <td :class="[cellPad, 'text-slate-500']">{{ part.location || '—' }}</td>
            <td v-if="hasActions" :class="cellPad" @click.stop>
              <slot name="actions" :part="part" />
            </td>
          </tr>
          <tr v-if="hasExpanded && expandedPartIds.has(part.id)" class="border-t-0">
            <!-- No background: the slot owns its ground, so it can pick one
                 that never matches a row. -->
            <td :colspan="columnCount" class="p-0">
              <slot name="expanded" :part="part" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <!-- Image lightbox -->
    <ImagePreviewModal
      v-model="imagePreviewOpen"
      :image="previewPart?.image"
      :title="previewPart?.name"
      :layer="imageLayer"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, useSlots } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next';
import ImagePreviewModal from '../../components/modal/ImagePreviewModal.vue';
import { formatPrice } from '../../utils/formatters.ts';
import type { ModalLayer } from '../../utils/overlayLayers.ts';
import type { Part } from '../../types/parts.ts';
import type { PartCategoryParameter } from '../../types/partCategories.ts';

const props = withDefaults(
  defineProps<{
    parts: Part[];
    // Category parameters rendered as their own columns (after Name). Their
    // values are pulled out of the shared "Other Parameters" cell.
    columnParameters?: PartCategoryParameter[];
    emptyText?: string;
    // ID of the currently selected part (highlighted row)
    selectedPartId?: number | null;
    // A set, not a single id: consumers open several at once.
    expandedPartIds?: Set<number>;
    // Tighter rows for the BOM views, where a revision plus its expanded
    // alternatives leaves only a handful visible at the default spacing.
    dense?: boolean;
    // Set to 'nested' when this table is rendered inside a dialog, so its
    // image lightbox opens above that dialog rather than beside it.
    imageLayer?: ModalLayer;
  }>(),
  {
    columnParameters: () => [],
    selectedPartId: null,
    expandedPartIds: () => new Set<number>(),
    dense: false,
    imageLayer: 'modal',
  },
);

const cellPad = computed(() => (props.dense ? 'px-3 py-1.5' : 'p-4'));
const thumbSize = computed(() => (props.dense ? 'h-8 w-8' : 'h-12 w-12'));

const emit = defineEmits<{
  clickRow: [part: Part];
}>();

const { t } = useI18n();
const slots = useSlots();

const columnParameterIds = computed(
  () => new Set(props.columnParameters.map((p) => p.id)),
);

// The value a part holds for a given column parameter, or a dash if unset.
function columnValue(part: Part, parameter: PartCategoryParameter): string {
  const entry = part.parameters?.find(
    (v) => v.parameterId === parameter.id,
  );
  return entry?.value?.trim() ? entry.value : '—';
}

// Parameter values shown in the shared cell — everything not promoted to its
// own column.
function otherParameters(part: Part) {
  return (part.parameters ?? []).filter(
    (v) => !columnParameterIds.value.has(v.parameterId),
  );
}

// ---- Sorting by a parameter column ----
// Clicking a column header cycles that column asc -> desc -> unsorted.
type SortDir = 'asc' | 'desc';
const sortParameterId = ref<number | null>(null);
const sortDir = ref<SortDir>('asc');

function toggleSort(parameter: PartCategoryParameter) {
  if (parameter.id == null) return;

  if (sortParameterId.value !== parameter.id) {
    sortParameterId.value = parameter.id;
    sortDir.value = 'asc';
  } else if (sortDir.value === 'asc') {
    sortDir.value = 'desc';
  } else {
    sortParameterId.value = null;
  }
}

// Drop a stale sort when the available columns change (e.g. a different
// category is selected), so we never sort by a column that's no longer shown.
watch(columnParameterIds, (ids) => {
  if (sortParameterId.value !== null && !ids.has(sortParameterId.value)) {
    sortParameterId.value = null;
  }
});

const sortedParts = computed<Part[]>(() => {
  const pid = sortParameterId.value;
  if (pid === null) return props.parts;

  const parameter = props.columnParameters.find((p) => p.id === pid);
  if (!parameter) return props.parts;

  const numeric = parameter.type === 'number';
  const dir = sortDir.value === 'asc' ? 1 : -1;

  const valueFor = (part: Part) =>
    part.parameters?.find((v) => v.parameterId === pid)?.value ?? '';

  // Copy first — never mutate the prop array in place.
  return [...props.parts].sort((a, b) => {
    const av = valueFor(a).trim();
    const bv = valueFor(b).trim();

    // Parts without a value always sink to the bottom, both directions.
    if (av === '' && bv === '') return 0;
    if (av === '') return 1;
    if (bv === '') return -1;

    const cmp = numeric
      ? Number(av) - Number(bv)
      : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });

    return cmp * dir;
  });
});

// Optional columns: each renders only when the consumer fills its slot.
// `expanded` is a full-width row via colspan, so it isn't in columnCount.
const hasQty = computed(() => !!slots.qty);
const hasPosition = computed(() => !!slots.position);
const hasActions = computed(() => !!slots.actions);
const hasExpanded = computed(() => !!slots.expanded);

// Fixed columns: image, code, name, category, price, stock, other
// parameters, location. Drives the empty row's colspan, so it has to track
// the header.
const FIXED_COLUMNS = 8;

const columnCount = computed(
  () =>
    FIXED_COLUMNS +
    props.columnParameters.length +
    (hasQty.value ? 1 : 0) +
    (hasPosition.value ? 1 : 0) +
    (hasActions.value ? 1 : 0),
);

const imagePreviewOpen = ref(false);
const previewPart = ref<Part | null>(null);

function openImagePreview(part: Part) {
  previewPart.value = part;
  imagePreviewOpen.value = true;
}

</script>
