<template>
  <div>
    <div class="flex items-center justify-between"><div><h1 class="text-3xl font-bold">Alkatrész kategóriák</h1><p class="mt-1 text-slate-500">Define dynamic parameter templates for parts.</p></div><button class="btn-primary" @click="addParam">+ Parameter</button></div>
    <form class="card mt-6 p-6" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2"><input v-model="form.name" class="input" placeholder="Category name" /><input v-model="form.image" class="input" placeholder="Image URL" /><input v-model="form.description" class="input md:col-span-2" placeholder="Description" /></div>
      <h2 class="mt-6 font-semibold">Parameters</h2>
      <div class="mt-3 space-y-3">
        <div v-for="(p,i) in form.parameters" :key="i" class="grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-5">
          <input v-model="p.name" class="input" placeholder="Parameter name" />
          <select v-model="p.type" class="input"><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option></select>
          <input v-model="p.unit" class="input" placeholder="Unit" />
          <label class="flex items-center gap-2 text-sm"><input v-model="p.required" type="checkbox" /> Required</label>
          <button type="button" class="btn-secondary" @click="form.parameters.splice(i,1)">Remove</button>
        </div>
      </div>
      <button class="btn-primary mt-6">Save category</button>
    </form>
    <div class="mt-6 grid gap-4 md:grid-cols-2"><div v-for="c in categories" :key="c.id" class="card p-5"><div class="flex gap-4"><img v-if="c.image" :src="c.image" class="h-16 w-16 rounded-xl object-cover ring-1 ring-slate-200" /><div><div class="font-bold">{{ c.name }}</div><p class="text-sm text-slate-500">{{ c.description }}</p></div></div><div class="mt-3 flex flex-wrap gap-2"><span v-for="p in c.parameters" :key="p.id" class="badge bg-blue-50 text-blue-700">{{ p.name }} {{ p.unit ? '('+p.unit+')' : '' }}</span></div></div></div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api/client';
const categories = ref<any[]>([]);
const form = reactive({ name:'', description:'', image:'', parameters: [] as any[] });
function addParam(){ form.parameters.push({ name:'', type:'text', unit:'', required:false }); }
async function load(){ categories.value = (await api.get('/part-categories')).data; }
async function save(){ await api.post('/part-categories', form); form.name=''; form.description=''; form.image=''; form.parameters=[]; await load(); }
onMounted(load);
</script>
