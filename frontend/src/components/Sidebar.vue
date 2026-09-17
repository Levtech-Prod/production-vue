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
      <template v-for="item in items" :key="item.to">
        <!-- Collapsed sidebar + group item: the icon still navigates to the
             group root on click, and hovering or focusing it opens a flyout
             with the children (the only way to reach Offer Processing while
             collapsed, since there's no room for an inline sub-list). -->
        <div v-if="item.children && ui.sidebarCollapsed" class="group relative">
          <RouterLink class="nav collapsed" :to="item.to" :title="item.label">
            <span class="nav-link justify-center">
              <component :is="item.icon" :size="20" class="shrink-0" />
            </span>
          </RouterLink>
          <div class="flyout absolute left-full top-0 z-20 ml-2 w-56 rounded-xl bg-slate-950 p-2 shadow-xl ring-1 ring-slate-800">
            <div class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {{ item.label }}
            </div>
            <SidebarNavChild
              v-for="child in item.children"
              :key="child.label"
              :to="child.to"
              :label="child.label"
              :disabled="child.disabled"
            />
          </div>
        </div>

        <template v-else>
          <RouterLink
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
              <template v-if="!ui.sidebarCollapsed">
                <span class="flex-1">{{ item.label }}</span>
                <ChevronDown
                  v-if="item.children"
                  :size="16"
                  class="shrink-0 transition-transform"
                  :class="{ '-rotate-90': !isGroupOpen(item) }"
                  @click.stop.prevent="ui.toggleSidebarGroup(item.to)"
                />
              </template>
            </span>
          </RouterLink>

          <div v-if="item.children && !ui.sidebarCollapsed && isGroupOpen(item)" class="pl-8">
            <SidebarNavChild
              v-for="child in item.children"
              :key="child.label"
              :to="child.to"
              :label="child.label"
              :disabled="child.disabled"
            />
          </div>
        </template>
      </template>
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
import { computed, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/uiStore';
import { useI18n } from 'vue-i18n';
import SidebarNavChild from './SidebarNavChild.vue';
import {
  LayoutDashboard,
  Users,
  FolderTree,
  Boxes,
  Package,
  FolderKanban,
  Settings,
  LogOut,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-vue-next';

interface NavChild {
  // Absent for a disabled entry: it has no route yet (see NavItem.children).
  to?: string;
  label: string;
  disabled?: boolean;
}

interface NavItem {
  to: string;
  label: string;
  icon: Component;
  section?: string;
  children?: NavChild[];
}

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();

const items = computed<NavItem[]>(() => [
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
    to: '/projects-preparation',
    label: t('projects_preparation'),
    icon: FolderKanban,
    children: [
      { to: '/projects-preparation/projects', label: t('projects') },
      { to: '/projects-preparation/offers', label: t('offer_processing') },
      { label: t('orders'), disabled: true },
      { label: t('preparation'), disabled: true },
    ],
  },
  {
    to: '/settings/product-types',
    label: t('product_types_settings'),
    icon: Settings,
    section: 'Beállítások',
  },
]);

function isGroupOpen(item: NavItem): boolean {
  return route.path.startsWith(item.to) || ui.openSidebarGroups.includes(item.to);
}

function logout() {
  auth.logout();
  router.push('/login');
}
</script>
<style scoped>
/* Shown on hover/focus-within of the trigger icon (see the collapsed group
   branch above). Hiding is delayed rather than instant: without it, moving
   the pointer diagonally from the icon toward a child link crosses the gap
   between them and closes the menu before it arrives. */
.flyout {
  visibility: hidden;
  opacity: 0;
  transition:
    opacity 150ms ease,
    visibility 0s linear 150ms;
}
.group:hover .flyout,
.group:focus-within .flyout {
  visibility: visible;
  opacity: 1;
  transition: opacity 150ms ease;
}
</style>
