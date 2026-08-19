<template>
  <header
    class="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur"
  >
    <!-- On a detail page the left slot is the way back to the list it came
         from; on a top-level page it is that page's heading. Views therefore
         don't render an <h1> of their own. -->
    <div class="min-w-0">
      <RouterLink
        v-if="back"
        :to="back.to"
        class="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-700"
      >
        <ChevronLeft class="h-4 w-4" />
        {{ t(back.labelKey) }}
      </RouterLink>
      <h1 v-else class="truncate text-2xl font-bold text-slate-800">{{ title }}</h1>
    </div>
    <div class="flex items-center gap-4">
      <input class="input w-72" :placeholder="t('search')" />
      <div
        class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold text-white"
      >
        {{ initials }}
      </div>
      <div class="text-sm">
        <div class="font-semibold">{{ auth.user?.username }}</div>
        <div class="text-xs text-slate-500">
          {{ auth.user?.admin ? t('admin') : t('client') }}
        </div>
      </div>
    </div>
  </header>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronLeft } from 'lucide-vue-next';
import { useAuthStore } from '../stores/auth';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const back = computed(() => route.meta.back);
// Routes declare their heading via meta.titleKey; the path-derived fallback is
// only there so a route that forgets one still shows something sensible.
const title = computed(() =>
  route.meta.titleKey
    ? t(route.meta.titleKey)
    : String(route.path).split('/').filter(Boolean).join(' / ') || 'Dashboard',
);
const initials = computed(
  () => auth.user?.username?.slice(0, 2).toUpperCase() || 'U',
);
</script>
