<!--
  A sortable column heading: its label and the three-state chevron that says
  whether this is the sorted column and which way. Pairs with `useTableSort`,
  whose `sortKey` and `sortDir` are what it reads; the click stays on the `th`,
  because a header cell is the click target, not the text inside it.
-->
<template>
  <span class="inline-flex items-center gap-1">
    {{ label }}
    <ChevronUp v-if="activeKey === sortKey && dir === 'asc'" class="h-3.5 w-3.5" />
    <ChevronDown v-else-if="activeKey === sortKey && dir === 'desc'" class="h-3.5 w-3.5" />
    <ChevronsUpDown v-else class="h-3.5 w-3.5 text-blue-400" />
  </span>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-vue-next';
import type { SortDir } from '../composables/useTableSort.ts';

defineProps<{
  label: string;
  /** This column's key. */
  sortKey: string;
  /** The key the table is sorted by, or null when it is unsorted. */
  activeKey: string | null;
  dir: SortDir;
}>();
</script>
