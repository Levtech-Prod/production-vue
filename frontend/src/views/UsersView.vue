<template>
  <div>
    <h1 class="text-3xl font-bold">Felhasználók</h1>
    <div class="card mt-6 overflow-hidden">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="p-4">Username</th><th>Email</th><th>Phone</th><th>Role</th><th>Created</th></tr></thead>
        <tbody><tr v-for="u in users" :key="u.id" class="border-t border-slate-100"><td class="p-4 font-semibold">{{ u.username }}</td><td>{{ u.email }}</td><td>{{ u.phone || '-' }}</td><td><span class="badge" :class="u.admin ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'">{{ u.admin ? 'Admin' : 'Client' }}</span></td><td>{{ new Date(u.createdAt).toLocaleString() }}</td></tr></tbody>
      </table>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
const users = ref<any[]>([]);
onMounted(async () => { users.value = (await api.get('/users')).data; });
</script>
