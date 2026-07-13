<template>
  <div
    class="grid items-stretch gap-x-2 border-t border-slate-100 px-3 py-2"
    :style="{ gridTemplateColumns: outerGrid(isSingle) }"
  >
    <CompareProductSide
      :revision="row.revA"
      :name="row.name"
      :sku="row.sku"
      :image="row.image"
      :same="row.same"
      :show-drill="row.status === 'changed' && !!row.revB"
      @drill="$emit('drill', row)"
    />
    <CompareStatusDot v-if="!isSingle" :status="row.status" />
    <CompareProductSide
      v-if="!isSingle"
      :revision="row.revB"
      :name="row.name"
      :sku="row.sku"
      :image="row.image"
      :same="row.same"
    />
  </div>
</template>

<script setup lang="ts">
import CompareProductSide from './CompareProductSide.vue';
import CompareStatusDot from './CompareStatusDot.vue';
import { outerGrid } from './compareHelpers.ts';
import type { CompareProductRow as CompareProductRowT } from './types.ts';

defineProps<{ row: CompareProductRowT; isSingle: boolean }>();
defineEmits<{ drill: [row: CompareProductRowT] }>();
</script>
