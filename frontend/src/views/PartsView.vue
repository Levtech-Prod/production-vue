<template>
  <div>
    <h1 class="text-3xl font-bold">Alkatrészek</h1>
    <form class="card mt-6 p-6" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2">
        <select v-model.number="form.categoryId" class="input">
          <option :value="0">Select category</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
        <input v-model="form.name" class="input" placeholder="Name" />
        <input
          v-model.number="form.pricePerPiece"
          type="number"
          step="0.01"
          class="input"
          placeholder="Price per piece"
        />
        <input v-model="form.location" class="input" placeholder="Location" />
        <textarea
          v-model="form.description"
          class="input md:col-span-2"
          placeholder="Description"
        ></textarea>
      </div>
      <h2 class="mt-6 font-semibold">Parameters</h2>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <label
          v-for="p in selectedCategory?.parameters || []"
          :key="p.id"
          class="text-sm font-medium text-slate-600"
          >{{ p.name }} {{ p.unit ? '(' + p.unit + ')' : ''
          }}<input
            v-model="parameterValues[p.id]"
            class="input mt-1"
            :required="p.required"
        /></label>
      </div>
      <button class="btn-primary mt-6">Save part</button>
    </form>
    <div class="card mt-6 overflow-hidden">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-4">Name</th>
            <th>Category</th>
            <th>Price / piece</th>
            <th>Location</th>
            <th>Parameters</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="part in parts"
            :key="part.id"
            class="border-t border-slate-100"
          >
            <td class="p-4 font-semibold">{{ part.name }}</td>
            <td>{{ part.category.name }}</td>
            <td>{{ part.pricePerPiece }}</td>
            <td>{{ part.location || '-' }}</td>
            <td>
              <span
                v-for="v in part.parameters"
                :key="v.id"
                class="mr-2 text-xs text-slate-600"
                >{{ v.parameter.name }}: {{ v.value }}</span
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../api/client';
const categories = ref<any[]>([]);
const parts = ref<any[]>([]);
const parameterValues = reactive<Record<number, string>>({});
const form = reactive({
  categoryId: 0,
  name: '',
  pricePerPiece: 0,
  location: '',
  description: '',
});
const selectedCategory = computed(() =>
  categories.value.find((c) => c.id === form.categoryId),
);
watch(
  () => form.categoryId,
  () => {
    Object.keys(parameterValues).forEach(
      (k) => delete parameterValues[Number(k)],
    );
  },
);
async function load() {
  categories.value = (await api.get('/part-categories')).data;
  parts.value = (await api.get('/parts')).data;
}
async function save() {
  await api.post('/parts', {
    ...form,
    parameters: Object.entries(parameterValues).map(([parameterId, value]) => ({
      parameterId: Number(parameterId),
      value,
    })),
  });
  Object.assign(form, {
    categoryId: 0,
    name: '',
    pricePerPiece: 0,
    location: '',
    description: '',
  });
  Object.keys(parameterValues).forEach(
    (k) => delete parameterValues[Number(k)],
  );
  await load();
}
onMounted(load);
</script>
