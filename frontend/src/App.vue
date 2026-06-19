<template>
  <router-view v-if="isAuthPage" />
  <div v-else class="min-h-screen bg-slate-50">
    <Sidebar />
    <main class="pl-64">
      <Topbar />
      <div class="p-6"><router-view /></div>
    </main>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './components/Sidebar.vue';
import Topbar from './components/Topbar.vue';
const route = useRoute();
const isAuthPage = computed(() => ['/login', '/signup'].includes(route.path));
</script>
