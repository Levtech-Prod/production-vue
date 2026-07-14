<template>
  <div
    class="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-white/95 px-4 py-2 backdrop-blur"
  >
    <button
      type="button"
      class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
      :class="
        modelValue === 'all'
          ? 'border-slate-500 bg-slate-700 text-white'
          : 'border-slate-200 text-slate-500 hover:border-slate-300'
      "
      @click="$emit('update:modelValue', 'all')"
    >
      {{ t('all') }} · {{ total }}
    </button>
    <button
      v-for="f in filters"
      :key="f.status"
      type="button"
      class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-35"
      :class="modelValue === f.status ? f.activeClass : f.idleClass"
      :disabled="summary[f.status] === 0"
      @click="$emit('update:modelValue', modelValue === f.status ? 'all' : f.status)"
    >
      {{ f.sign }}{{ summary[f.status] }} {{ t('compare_status.' + f.status).toLowerCase() }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { CompareStatus } from '../../../../types/products.ts';
import type { StatusFilterDef } from './composables/useCompareParts.ts';

defineProps<{
  modelValue: CompareStatus | 'all';
  filters: StatusFilterDef[];
  summary: Record<CompareStatus, number>;
  total: number;
}>();
defineEmits<{ 'update:modelValue': [value: CompareStatus | 'all'] }>();

const { t } = useI18n();
</script>
