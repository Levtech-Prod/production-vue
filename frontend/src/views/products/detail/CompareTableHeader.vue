<template>
  <div class="border-b border-slate-200 px-3 py-2">
    <div class="grid items-center gap-x-2" :style="{ gridTemplateColumns: outerGrid(isSingle) }">
      <div class="flex items-center gap-1.5 rounded-md bg-blue-50/60 px-2 py-1">
        <CompareRevisionBadge side="A" />
        <span class="truncate text-xs font-semibold text-blue-700">{{ labelA }}</span>
      </div>
      <div v-if="!isSingle"></div>
      <div
        v-if="!isSingle"
        class="flex items-center gap-1.5 rounded-md bg-emerald-50/60 px-2 py-1"
      >
        <CompareRevisionBadge side="B" />
        <span class="truncate text-xs font-semibold text-emerald-700">{{ labelB }}</span>
      </div>
    </div>
    <div
      class="mt-1 grid items-center gap-x-2"
      :style="{ gridTemplateColumns: outerGrid(isSingle) }"
    >
      <div
        class="grid items-center gap-x-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"
        :style="{ gridTemplateColumns: sideTemplate }"
      >
        <div></div>
        <div v-for="(col, i) in columns" :key="i" :class="col.center ? 'text-center' : ''">
          {{ col.label }}
        </div>
      </div>
      <div v-if="!isSingle"></div>
      <div
        v-if="!isSingle"
        class="grid items-center gap-x-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"
        :style="{ gridTemplateColumns: sideTemplate }"
      >
        <div></div>
        <div v-for="(col, i) in columns" :key="i" :class="col.center ? 'text-center' : ''">
          {{ col.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import CompareRevisionBadge from './CompareRevisionBadge.vue';
import { outerGrid } from './compareHelpers.ts';

defineProps<{
  isSingle: boolean;
  labelA: string;
  labelB: string;
  /** grid-template-columns value for one side, e.g. PRODUCT_SIDE_GRID. */
  sideTemplate: string;
  columns: Array<{ label: string; center?: boolean }>;
}>();
</script>
