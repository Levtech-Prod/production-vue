<template>
  <span
    class="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
    :class="side === 'A' ? 'bg-blue-600' : 'bg-emerald-600'"
    >{{ side }}</span
  >
</template>

<script setup lang="ts">
defineProps<{ side: 'A' | 'B' }>();
</script>
