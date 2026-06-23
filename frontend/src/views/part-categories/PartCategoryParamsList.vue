<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Paraméterek
      </h3>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-md transition-colors"
        @click="addParam"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clip-rule="evenodd"
          />
        </svg>
        Paraméter hozzáadása
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-if="parameters.length === 0"
      class="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center"
    >
      <p class="text-sm text-slate-400">Még nincs paraméter megadva.</p>
    </div>

    <!-- Rows -->
    <div class="space-y-2">
      <div
        v-for="(p, i) in parameters"
        :key="i"
        class="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-5"
      >
        <input v-model="p.name" class="input text-sm" placeholder="Név" />
        <select v-model="p.type" class="input text-sm">
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
        </select>
        <input v-model="p.unit" class="input text-sm" placeholder="Egység" />
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input v-model="p.required" type="checkbox" class="rounded" />
          Kötelező
        </label>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-lg text-sm text-red-500 hover:bg-red-50 px-2 py-1.5 transition-colors"
          @click="removeParam(i)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PartCategoryParameter } from '../../types/partCategories.ts';

const parameters = defineModel<PartCategoryParameter[]>({ required: true });

function addParam() {
  parameters.value.push({ name: '', type: 'text', unit: '', required: false });
}

function removeParam(index: number) {
  parameters.value.splice(index, 1);
}
</script>
