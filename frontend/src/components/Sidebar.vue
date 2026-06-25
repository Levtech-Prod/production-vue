<template>
  <aside class="fixed inset-y-0 left-0 w-64 bg-slate-950 text-slate-200">
    <div class="flex items-center gap-3 px-6 py-6">
      <div
        class="grid h-10 w-10 place-items-center rounded-xl border border-blue-400 text-blue-400"
      >
        ▣
      </div>
      <div>
        <div class="font-bold tracking-wide text-white">Production</div>
        <div class="text-xs text-slate-400">
          {{ t('production_tracking_system') }}
        </div>
      </div>
    </div>
    <nav class="px-3 text-sm">
      <RouterLink class="nav" to="/dashboard">{{ t('dashboard') }}</RouterLink>
      <div class="section">Rendszer</div>
      <RouterLink class="nav" to="/users">{{ t('users') }}</RouterLink>
      <div class="section">Raktár</div>
      <RouterLink class="nav" to="/stock/categories">{{
        t('part_categories_title')
      }}</RouterLink>
      <RouterLink class="nav" to="/stock/parts">{{ t('parts') }}</RouterLink>
    </nav>
    <button
      class="absolute bottom-4 left-3 right-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-slate-900"
      @click="logout"
    >
      {{ t('logout') }}
    </button>
  </aside>
</template>
<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
function logout() {
  auth.logout();
  router.push('/login');
}
</script>
<style scoped>
.nav {
  display: block;
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
  color: #cbd5e1;
}
.nav:hover,
.router-link-active {
  background: #0b79e0;
  color: white;
}
.section {
  padding: 1.25rem 1rem 0.5rem;
  color: #94a3b8;
  text-transform: uppercase;
  font-size: 0.75rem;
}
</style>
