<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
    :class="chipClass"
  >
    <span class="h-1.5 w-1.5 rounded-full" :class="dotClass" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RevisionStatus } from '../../types/products.ts';

const props = defineProps<{
  label: string;
  status: RevisionStatus;
}>();

const chipClass = computed(
  () =>
    ({
      draft: 'border-slate-200 bg-slate-50 text-slate-600',
      active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      deprecated: 'border-amber-200 bg-amber-50 text-amber-700',
    })[props.status],
);

const dotClass = computed(
  () =>
    ({
      draft: 'bg-slate-400',
      active: 'bg-emerald-500',
      deprecated: 'bg-amber-500',
    })[props.status],
);
</script>
