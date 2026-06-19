<template>
  <header
    class="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur"
  >
    <div class="text-sm text-slate-500">
      Production / <span class="font-semibold text-slate-800">{{ title }}</span>
    </div>
    <div class="flex items-center gap-4">
      <input class="input w-72" placeholder="Keresés..." />
      <div
        class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold text-white"
      >
        {{ initials }}
      </div>
      <div class="text-sm">
        <div class="font-semibold">{{ auth.user?.username }}</div>
        <div class="text-xs text-slate-500">
          {{ auth.user?.admin ? 'Admin' : 'Client' }}
        </div>
      </div>
    </div>
  </header>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
const route = useRoute();
const auth = useAuthStore();
const title = computed(
  () =>
    String(route.path).split('/').filter(Boolean).join(' / ') || 'Dashboard',
);
const initials = computed(
  () => auth.user?.username?.slice(0, 2).toUpperCase() || 'U',
);
</script>
