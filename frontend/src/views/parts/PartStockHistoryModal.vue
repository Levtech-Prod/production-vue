<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="$emit('update:modelValue', false)"
      >
        <div
          class="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col"
          style="max-height: 85vh;"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-100 shrink-0"
          >
            <div class="min-w-0">
              <h2 class="font-semibold text-slate-900 leading-tight">
                {{ t('stock_history') }}
              </h2>
              <p class="text-xs text-slate-400 truncate">{{ partName }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              @click="$emit('update:modelValue', false)"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Search -->
          <div class="px-5 py-3 border-b border-slate-100 shrink-0">
            <div class="relative max-w-xs">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                v-model="search"
                class="input !pl-9 text-sm"
                :placeholder="t('search_by_company')"
              />
            </div>
          </div>

          <!-- Table -->
          <div class="flex-1 overflow-y-auto min-h-0">
            <table class="w-full text-left text-sm">
              <thead class="bg-blue-50 text-xs uppercase text-black sticky top-0 z-10">
                <tr>
                  <th
                    class="cursor-pointer select-none p-4 hover:bg-blue-100"
                    @click="toggleSort('company')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('company') }}
                      <ChevronUp v-if="sortField === 'company' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'company' && sortDir === 'desc'" class="h-3.5 w-3.5" />
                      <ChevronsUpDown v-else class="h-3.5 w-3.5 text-slate-300" />
                    </span>
                  </th>
                  <th
                    class="cursor-pointer select-none p-4 hover:bg-blue-100"
                    @click="toggleSort('quantity')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('quantity') }}
                      <ChevronUp v-if="sortField === 'quantity' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'quantity' && sortDir === 'desc'" class="h-3.5 w-3.5" />
                      <ChevronsUpDown v-else class="h-3.5 w-3.5 text-slate-300" />
                    </span>
                  </th>
                  <th
                    class="cursor-pointer select-none p-4 hover:bg-blue-100"
                    @click="toggleSort('price')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('price_per_piece') }}
                      <ChevronUp v-if="sortField === 'price' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'price' && sortDir === 'desc'" class="h-3.5 w-3.5" />
                      <ChevronsUpDown v-else class="h-3.5 w-3.5 text-slate-300" />
                    </span>
                  </th>
                  <th
                    class="cursor-pointer select-none p-4 hover:bg-blue-100"
                    @click="toggleSort('date')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('date') }}
                      <ChevronUp v-if="sortField === 'date' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'date' && sortDir === 'desc'" class="h-3.5 w-3.5" />
                      <ChevronsUpDown v-else class="h-3.5 w-3.5 text-slate-300" />
                    </span>
                  </th>
                  <th
                    class="cursor-pointer select-none p-4 hover:bg-blue-100"
                    @click="toggleSort('enteredBy')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('entered_by') }}
                      <ChevronUp v-if="sortField === 'enteredBy' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'enteredBy' && sortDir === 'desc'" class="h-3.5 w-3.5" />
                      <ChevronsUpDown v-else class="h-3.5 w-3.5 text-slate-300" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredSortedEntries.length === 0">
                  <td colspan="5" class="py-12 text-center text-sm text-slate-400">
                    {{
                      search
                        ? t('no_search_results') + ' "' + search + '"'
                        : t('no_stock_entries')
                    }}
                  </td>
                </tr>
                <tr
                  v-for="entry in filteredSortedEntries"
                  :key="entry.id"
                  class="border-t border-slate-100 even:bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <td class="p-4 font-medium text-slate-800">{{ entry.company.name }}</td>
                  <td class="p-4 text-slate-700">{{ formatQty(entry.quantity) }}</td>
                  <td class="p-4 text-slate-700">{{ formatPrice(entry.pricePerPiece) }}</td>
                  <td class="p-4 text-slate-500 whitespace-nowrap">
                    {{ formatDate(entry.enteredAt) }}
                  </td>
                  <td class="p-4 text-slate-500">{{ entry.enteredBy?.username ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Footer -->
          <div
            v-if="entries.length"
            class="px-5 py-3 border-t border-slate-100 shrink-0 text-xs text-slate-400"
          >
            {{ filteredSortedEntries.length }} / {{ entries.length }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { X, Search, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { StockEntry } from '../../types/stockEntries.ts';

const props = defineProps<{
  modelValue: boolean;
  entries: StockEntry[];
  partName: string;
}>();

defineEmits<{ 'update:modelValue': [value: boolean] }>();

const { t } = useI18n();

// ── Search ────────────────────────────────────────────────────────────────────

const search = ref('');

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortField = 'company' | 'quantity' | 'price' | 'date' | 'enteredBy';
type SortDir = 'asc' | 'desc';

const sortField = ref<SortField>('date');
const sortDir = ref<SortDir>('desc'); // newest first by default

function toggleSort(field: SortField) {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortDir.value = field === 'date' ? 'desc' : 'asc';
  }
}

// ── Filtered + sorted entries ─────────────────────────────────────────────────

const filteredSortedEntries = computed<StockEntry[]>(() => {
  const q = search.value.trim().toLowerCase();
  const filtered = q
    ? props.entries.filter((e) => e.company.name.toLowerCase().includes(q))
    : [...props.entries];

  const dir = sortDir.value === 'asc' ? 1 : -1;

  return filtered.sort((a, b) => {
    switch (sortField.value) {
      case 'company':
        return a.company.name.localeCompare(b.company.name) * dir;
      case 'quantity':
        return (Number(a.quantity) - Number(b.quantity)) * dir;
      case 'price':
        return (Number(a.pricePerPiece) - Number(b.pricePerPiece)) * dir;
      case 'date':
        return (new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime()) * dir;
      case 'enteredBy': {
        const an = a.enteredBy?.username ?? '';
        const bn = b.enteredBy?.username ?? '';
        return an.localeCompare(bn) * dir;
      }
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatQty(value: number | string): string {
  return Math.round(Number(value)).toString();
}

function formatPrice(value: number | string): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
