<template>
  <div
    v-if="side"
    class="grid items-start gap-x-2 rounded-md px-1.5 py-1"
    :style="{ gridTemplateColumns: PART_SIDE_GRID }"
    :class="sideAccentClass(same)"
  >
    <div
      class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-300"
    >
      <img v-if="row.image" :src="row.image" class="h-full w-full object-cover" :alt="row.name" />
      <template v-else>▣</template>
    </div>
    <div class="min-w-0 break-words">
      <div class="font-semibold text-slate-800">{{ row.name }}</div>
      <div class="font-mono text-xs text-slate-400">{{ row.code }}</div>
    </div>
    <div class="min-w-0 break-words text-center">
      <div class="text-xs font-medium tabular-nums text-slate-700">{{ sideQty(side) }}</div>
      <div v-if="delta" class="text-[10px] text-slate-400">({{ delta }})</div>
    </div>
    <div class="min-w-0 self-center break-words">
      <template v-if="hasDetails(row)">
        <div v-if="row.categoryName" class="text-[11px] leading-4 text-slate-600">
          {{ row.categoryName }}
        </div>
        <div
          v-if="row.pricePerPiece != null && row.pricePerPiece !== ''"
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
      <div v-if="side.mountPosition" class="text-[10px] text-slate-400">
        {{ t('mount_position') }}: {{ side.mountPosition }}
      </div>
      <div v-if="side.notes" class="text-[10px] text-slate-400">
        {{ t('notes') }}: {{ side.notes }}
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

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ComparePartRow, ComparePartSide as PartSideData } from '../../../../types/products.ts';
import { PART_SIDE_GRID, hasDetails, sideAccentClass, sideQty } from './compareHelpers.ts';

defineProps<{
  row: ComparePartRow;
  /** row.inA or row.inB — the quantity/position/notes payload for this side. */
  side: PartSideData | null;
  same: boolean | null;
  /** Quantity delta vs. the other side, shown on side B only. */
  delta?: string;
}>();

const { t } = useI18n();
</script>
