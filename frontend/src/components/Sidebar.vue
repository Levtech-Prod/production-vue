<template>
  <aside
    class="fixed inset-y-0 left-0 bg-slate-950 text-slate-200 transition-all duration-200"
    :class="ui.sidebarCollapsed ? 'w-20' : 'w-64'"
  >
    <div
      class="flex items-center px-6 py-6"
      :class="ui.sidebarCollapsed ? 'justify-center px-0' : 'justify-between gap-3'"
    >
      <div class="flex items-center gap-3">
        <div
          class="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-blue-400 text-blue-400"
        >
          ▣
        </div>
        <div v-if="!ui.sidebarCollapsed">
          <div class="font-bold tracking-wide text-white">Production</div>
          <div class="text-xs text-slate-400">
            {{ t('production_tracking_system') }}
          </div>
        </div>
      </div>
      <button
        v-if="!ui.sidebarCollapsed"
        class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-900 hover:text-white"
        :title="t('collapse_menu')"
        @click="ui.toggleSidebar()"
      >
        <ChevronsLeft :size="20" />
      </button>
    </div>

    <button
      v-if="ui.sidebarCollapsed"
      class="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-900 hover:text-white"
      :title="t('expand_menu')"
      @click="ui.toggleSidebar()"
    >
      <ChevronsRight :size="20" />
    </button>

    <nav class="px-3 text-sm">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        class="nav"
        :class="{ collapsed: ui.sidebarCollapsed }"
        :to="item.to"
        :title="ui.sidebarCollapsed ? item.label : undefined"
      >
        <template v-if="item.section && !ui.sidebarCollapsed">
          <span class="section">{{ item.section }}</span>
        </template>
        <span class="nav-link" :class="{ 'justify-center': ui.sidebarCollapsed }">
          <component :is="item.icon" :size="20" class="shrink-0" />
          <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
        </span>
      </RouterLink>
    </nav>

    <button
      class="absolute bottom-4 left-3 right-3 flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-slate-900"
      :class="{ 'justify-center px-0': ui.sidebarCollapsed }"
      :title="ui.sidebarCollapsed ? t('logout') : undefined"
      @click="logout"
    >
      <LogOut :size="20" class="shrink-0" />
      <span v-if="!ui.sidebarCollapsed">{{ t('logout') }}</span>
    </button>
  </aside>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/uiStore';
import { useI18n } from 'vue-i18n';
import {
  LayoutDashboard,
  Users,
  FolderTree,
  Boxes,
  Package,
  Settings,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-vue-next';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();

const items = computed(() => [
  { to: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
  { to: '/users', label: t('users'), icon: Users, section: 'Rendszer' },
  {
    to: '/stock/categories',
    label: t('part_categories_title'),
    icon: FolderTree,
    section: 'Raktár',
  },
  { to: '/stock/parts', label: t('stock'), icon: Boxes },
  { to: '/products', label: t('products'), icon: Package, section: 'Gyártás' },
  {
    to: '/settings/product-types',
    label: t('product_types_settings'),
    icon: Settings,
    section: 'Beállítások',
  },
]);

function logout() {
  auth.logout();
  router.push('/login');
}
</script>
<style scoped>
.nav {
  display: block;
  border-radius: 0.75rem;
  color: #cbd5e1;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
}
.nav:hover .nav-link,
.router-link-active .nav-link {
  background: #0b79e0;
  color: white;
}
.section {
  display: block;
  padding: 1.25rem 1rem 0.5rem;
  color: #94a3b8;
  text-transform: uppercase;
  font-size: 0.75rem;
}
</style>
