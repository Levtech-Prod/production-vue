<template>
  <div class="card mt-6 overflow-hidden">
    <!-- Search bar -->
    <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
      <h2 class="text-sm font-semibold text-slate-600">
        {{ t('categories') }}
      </h2>
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
          v-model="categorySearch"
          class="input !pl-9"
          :placeholder="t('search_part_categories_placeholder')"
        />
      </div>
      <span class="text-sm text-slate-400">
        {{ filteredCategories.length }} / {{ categories.length }}
        {{ t('category') }}
      </span>
    </div>

    <!-- Cards grid -->
    <div class="p-4">
      <div
        v-if="filteredCategories.length === 0"
        class="py-8 text-center text-sm text-slate-400"
      >
        <template v-if="categorySearch">
          {{ t('no_search_results') }}: "{{ categorySearch }}".
        </template>
        <template v-else>{{ t('no_categories_msg') }}</template>
      </div>
      <div
        v-else
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <button
          v-for="category in filteredCategories"
          :key="category.id"
          type="button"
          class="flex items-start gap-3 rounded-xl border p-3 text-left transition-colors"
          :class="
            selectedCategoryId === category.id
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
          "
          @click="toggleCategory(category.id)"
        >
          <img
            v-if="category.image"
            :src="category.image"
            class="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
          />
          <div
            v-else
            class="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
          >
            ▣
          </div>
          <div class="min-w-0">
            <div class="truncate font-semibold text-slate-800">
              {{ category.name }}
            </div>
            <div class="truncate text-xs text-slate-500">
              {{ category.description || '—' }}
            </div>
            <div class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="parameter in category.parameters"
                :key="parameter.id"
                class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
              >
                {{ parameter.name }}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, computed } from 'vue';
import { usePartCategoryStore } from '../../stores/partCategoriesStore.ts';
import type { PartCategory } from '../../types/partCategories.ts';

const props = defineProps<{
  categories: PartCategory[];
  selectedCategoryId: number;
}>();

const { t } = useI18n();
const partCategoryStore = usePartCategoryStore();

const categorySearch = ref('');
const selectedCategoryId = defineModel<number>('selectedCategoryId');
const categories = computed(() => partCategoryStore.categories);

const filteredCategories = computed(() => {
  const q = categorySearch.value.trim().toLowerCase();
  if (!q) return categories.value;
  return categories.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.parameters?.some((p) => p.name.toLowerCase().includes(q)),
  );
});

function toggleCategory(id: number) {
  selectedCategoryId.value = selectedCategoryId.value === id ? 0 : id;
}
</script>
