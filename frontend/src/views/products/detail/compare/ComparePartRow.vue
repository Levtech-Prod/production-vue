<template>
  <div
    class="grid items-stretch gap-x-2 border-t border-slate-100 px-3 py-2"
    :style="{ gridTemplateColumns: outerGrid(isSingle) }"
  >
    <ComparePartSide :row="row" :side="row.inA" :same="same" />
    <CompareStatusDot v-if="!isSingle" :status="row.status" />
    <ComparePartSide v-if="!isSingle" :row="row" :side="row.inB" :same="same" :delta="delta" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ComparePartRow as ComparePartRowT } from '../../../../types/products.ts';
import ComparePartSide from './ComparePartSide.vue';
import CompareStatusDot from './CompareStatusDot.vue';
import { outerGrid, partSame, qtyDelta } from './compareHelpers.ts';

const props = defineProps<{ row: ComparePartRowT; isSingle: boolean }>();

const same = computed(() => partSame(props.row, props.isSingle));
const delta = computed(() => qtyDelta(props.row, props.isSingle));
</script>
