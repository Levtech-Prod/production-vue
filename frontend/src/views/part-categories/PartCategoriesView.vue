<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold">Alkatrész kategóriák</h1>
        <p class="mt-1 text-slate-500">
          Define dynamic parameter templates for parts.
        </p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
        @click="openAdd"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clip-rule="evenodd"
          />
        </svg>
        Kategória hozzáadása
      </button>
    </div>

    <!-- Table card -->
    <div class="card mt-6 overflow-hidden">
      <!-- Search bar -->
      <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div class="relative flex-1 max-w-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clip-rule="evenodd"
            />
          </svg>
          <input
            v-model="searchQuery"
            class="input !pl-9"
            placeholder="Keresés név, leírás, paraméter alapján…"
          />
        </div>
        <span class="text-sm text-slate-400">
          {{ filteredCategories.length }} / {{ categories.length }} kategória
        </span>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-4">Név</th>
            <th class="p-4">Kép</th>
            <th class="p-4">Leírás</th>
            <th class="p-4">Paraméterek</th>
            <th class="p-4">Műveletek</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredCategories.length === 0">
            <td colspan="5" class="py-12 text-center text-sm text-slate-400">
              <template v-if="searchQuery">
                Nincs találat a(z) „{{ searchQuery }}" keresésre.
              </template>
              <template v-else>
                Még nincs kategória. Kattints a „Kategória hozzáadása" gombra az
                első létrehozásához.
              </template>
            </td>
          </tr>
          <tr
            v-for="category in filteredCategories"
            :key="category.id"
            class="border-t border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <td class="p-4 font-semibold">{{ category.name }}</td>
            <td class="p-4">
              <img
                v-if="category.image"
                :src="category.image"
                class="h-10 w-10 rounded-md border object-cover"
              />
              <span v-else class="text-slate-300">—</span>
            </td>
            <td class="p-4 text-slate-500">
              {{ category.description || '—' }}
            </td>
            <td class="p-4">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="parameter in category.parameters"
                  :key="parameter.id"
                  class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {{ parameter.name }}
                </span>
                <span v-if="!category.parameters?.length" class="text-slate-300"
                  >—</span
                >
              </div>
            </td>
            <td class="p-4">
              <button
                class="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium hover:bg-slate-200 transition-colors"
                @click="openEdit(category)"
              >
                Szerkesztés
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <CategoryFormModal
      v-model="modalOpen"
      :category="editingCategory"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { usePartCategoryStore } from '../../stores/partCategoriesStore.ts';
import type { PartCategory } from '../../types/partCategories.ts';
import CategoryFormModal from './PartCategoryModal.vue';

const store = usePartCategoryStore();
const categories = computed(() => store.categories);

// Search
const searchQuery = ref('');
const filteredCategories = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return categories.value;
  return categories.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.parameters?.some((p) => p.name.toLowerCase().includes(q)),
  );
});

// Modal state
const modalOpen = ref(false);
const editingCategory = ref<PartCategory | null>(null);

function openAdd() {
  editingCategory.value = null;
  modalOpen.value = true;
}

function openEdit(category: PartCategory) {
  editingCategory.value = category;
  modalOpen.value = true;
}

async function onSaved(payload: {
  name: string;
  description: string;
  image: string | null;
  parameters: PartCategory['parameters'];
}) {
  if (editingCategory.value) {
    await store.updateCategory(editingCategory.value.id, payload);
  } else {
    await store.saveCategory(payload);
  }
  await store.loadCategories();
}

onMounted(() => store.loadCategories());
</script>
