<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="$emit('update:modelValue', false)"
      >
        <div
          class="bg-white rounded-xl shadow-xl w-full max-w-5xl flex flex-col"
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
                :placeholder="t('search_by_company_or_note')"
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
                    @click="toggleSort('type')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('type') }}
                      <ChevronUp v-if="sortField === 'type' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'type' && sortDir === 'desc'" class="h-3.5 w-3.5" />
                      <ChevronsUpDown v-else class="h-3.5 w-3.5 text-slate-300" />
                    </span>
                  </th>
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
                    @click="toggleSort('note')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('note') }}
                      <ChevronUp v-if="sortField === 'note' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'note' && sortDir === 'desc'" class="h-3.5 w-3.5" />
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
                    @click="toggleSort('by')"
                  >
                    <span class="inline-flex items-center gap-1">
                      {{ t('entered_by') }}
                      <ChevronUp v-if="sortField === 'by' && sortDir === 'asc'" class="h-3.5 w-3.5" />
                      <ChevronDown v-else-if="sortField === 'by' && sortDir === 'desc'" class="h-3.5 w-3.5" />
                      <ChevronsUpDown v-else class="h-3.5 w-3.5 text-slate-300" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredSorted.length === 0">
                  <td colspan="7" class="py-12 text-center text-sm text-slate-400">
                    {{
                      search
                        ? t('no_search_results') + ' "' + search + '"'
                        : t('no_stock_entries')
                    }}
                  </td>
                </tr>
                <tr
                  v-for="item in filteredSorted"
                  :key="item.id"
                  class="border-t border-slate-100 even:bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <!-- Type badge -->
                  <td class="p-4">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                      :class="
                        item.type === 'received'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-red-50 text-red-700'
                      "
                    >
                      <ArrowDown v-if="item.type === 'received'" class="h-3 w-3" />
                      <ArrowUp v-else class="h-3 w-3" />
                      {{ item.type === 'received' ? t('received') : t('removed') }}
                    </span>
                  </td>
                  <!-- Company -->
                  <td class="p-4 text-slate-700 max-w-[140px]">
                    <span class="block truncate font-medium" :title="item.company ?? undefined">
                      {{ item.company || '—' }}
                    </span>
                  </td>
                  <!-- Note -->
                  <td class="p-4 text-slate-500 max-w-[160px]">
                    <span class="block truncate italic" :title="item.note ?? undefined">
                      {{ item.note || '—' }}
                    </span>
                  </td>
                  <td class="p-4 text-slate-700">{{ formatQty(item.quantity) }}</td>
                  <td class="p-4 text-slate-500">
                    {{ item.price != null ? formatPrice(item.price) : '—' }}
                  </td>
                  <td class="p-4 text-slate-500 whitespace-nowrap">
                    {{ formatDate(item.date) }}
                  </td>
                  <td class="p-4 text-slate-500">{{ item.by || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Footer -->
          <div
            v-if="allItems.length"
            class="px-5 py-3 border-t border-slate-100 shrink-0 text-xs text-slate-400"
          >
            {{ filteredSorted.length }} / {{ allItems.length }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { X, Search, ChevronUp, ChevronDown, ChevronsUpDown, ArrowDown, ArrowUp } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatQty, formatPrice, formatDate } from '../../utils/formatters.ts';
import type { StockEntry } from '../../types/stockEntries.ts';

const props = defineProps<{
  modelValue: boolean;
  entries: StockEntry[];
  partName: string;
}>();

defineEmits<{ 'update:modelValue': [value: boolean] }>();

const { t } = useI18n();

// ── Flat history item for the unified table ───────────────────────────────────

interface HistoryItem {
  id: string;
  type: 'received' | 'removed';
  company: string | null;
  note: string | null;
  quantity: number;
  price: number | null;
  date: string;
  by: string;
}

const allItems = computed<HistoryItem[]>(() =>
  props.entries.map((e) => ({
    id: String(e.id),
    type: e.type,
    company: e.company?.name ?? null,
    note: e.note ?? null,
    quantity: Number(e.quantity),
    price: e.pricePerPiece != null ? Number(e.pricePerPiece) : null,
    date: e.enteredAt,
    by: e.enteredBy?.username ?? '',
  })),
);

// ── Search ────────────────────────────────────────────────────────────────────

const search = ref('');

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortField = 'type' | 'company' | 'note' | 'quantity' | 'price' | 'date' | 'by';
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

// ── Filtered + sorted ─────────────────────────────────────────────────────────

const filteredSorted = computed<HistoryItem[]>(() => {
  const q = search.value.trim().toLowerCase();
  const filtered = q
    ? allItems.value.filter(
        (item) =>
          (item.company ?? '').toLowerCase().includes(q) ||
          (item.note ?? '').toLowerCase().includes(q),
      )
    : [...allItems.value];

  const dir = sortDir.value === 'asc' ? 1 : -1;

  return filtered.sort((a, b) => {
    switch (sortField.value) {
      case 'type':
        return a.type.localeCompare(b.type) * dir;
      case 'company':
        return (a.company ?? '').localeCompare(b.company ?? '') * dir;
      case 'note':
        return (a.note ?? '').localeCompare(b.note ?? '') * dir;
      case 'quantity':
        return (a.quantity - b.quantity) * dir;
      case 'price': {
        const ap = a.price ?? -1;
        const bp = b.price ?? -1;
        return (ap - bp) * dir;
      }
      case 'date':
        return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
      case 'by':
        return a.by.localeCompare(b.by) * dir;
    }
  });
});
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
