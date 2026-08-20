<template>
  <router-view v-if="isAuthPage" />
  <!-- The shell is exactly one viewport tall and never scrolls itself: the
       region below the Topbar is the scroll container. That lets a view opt
       into filling the remaining height (h-full) and scrolling inside its own
       panels rather than growing the page. -->
  <div v-else class="h-screen overflow-hidden bg-slate-100">
    <Sidebar />
    <main
      class="flex h-full flex-col transition-all duration-200"
      :class="ui.sidebarCollapsed ? 'pl-20' : 'pl-64'"
    >
      <Topbar />
      <div class="min-h-0 flex-1 overflow-y-auto p-6"><router-view /></div>

      <Toast />
      <AlertModal />
    </main>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './components/Sidebar.vue';
import Topbar from './components/Topbar.vue';
import Toast from './components/notification/Toast.vue';
import AlertModal from './components/notification/AlertModal.vue';
import { useUiStore } from './stores/uiStore';

const ui = useUiStore();
const route = useRoute();
const isAuthPage = computed(() => ['/login', '/signup'].includes(route.path));
</script>
