<template>
  <!-- No flex/h-full here — the parent card is the scroll container -->
  <div>
    <!-- ── Sticky header ── -->
    <div
      class="sticky top-0 z-10 bg-white border-b border-slate-200 flex items-center gap-2 px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <h2 class="font-semibold text-slate-900 truncate leading-tight">{{ part.name }}</h2>
        <div class="text-xs font-mono text-slate-400 truncate">{{ part.code }}</div>
        <div v-if="part.secondaryCodes?.length" class="text-[10px] font-mono text-slate-300 truncate">
          {{ part.secondaryCodes.join(', ') }}
        </div>
      </div>

      <div class="flex items-center gap-0.5 shrink-0">
        <!-- History — always available: every part has at least a change log -->
        <button
          type="button"
          class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          :title="t('history')"
          @click="showHistoryModal = true"
        >
          <Clock class="h-4 w-4" />
        </button>
        <button
          v-if="isAdmin"
          type="button"
          class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          :title="t('edit')"
          @click="$emit('edit', part)"
        >
          <Pencil class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          :title="t('close_panel')"
          @click="$emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </div>
    </div>

    <!-- ── Stock actions (primary) ── -->
    <section class="px-4 pt-4 pb-4 border-b border-slate-100">
      <div v-if="loading" class="flex items-center gap-2 text-sm text-slate-400 py-2">
        <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        {{ t('loading') }}
      </div>

      <template v-else>
        <!-- Summary cards -->
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div class="text-xs text-slate-400 mb-0.5">{{ t('in_stock') }}</div>
            <div class="text-2xl font-bold text-slate-900">{{ formatQty(totalQuantity) }}</div>
          </div>
          <div class="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div class="text-xs text-slate-400 mb-0.5">{{ t('avg_price_per_piece') }}</div>
            <div class="text-2xl font-bold text-slate-900">{{ formatPrice(avgPricePerPiece) }}</div>
          </div>
        </div>

        <!-- Remove / Add toggle — Remove is the default, highest-frequency action -->
        <div class="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 mb-3">
          <button
            type="button"
            class="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors"
            :class="
              activeTab === 'remove'
                ? 'bg-white text-red-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            "
            @click="activeTab = 'remove'"
          >
            <MinusCircle class="h-4 w-4" />
            {{ t('remove') }}
          </button>
          <button
            type="button"
            class="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors"
            :class="
              activeTab === 'add'
                ? 'bg-white text-green-600 shadow-sm'
                : 'text-green-600 hover:text-green-700'
            "
            @click="activeTab = 'add'"
          >
            <PlusCircle class="h-4 w-4" />
            {{ t('add_to_stock') }}
          </button>
        </div>

        <RemoveStockForm
          v-if="activeTab === 'remove'"
          :part="part"
          :max-quantity="totalQuantity"
        />
        <AddStockForm v-else :part="part" :companies="companies" />
      </template>
    </section>

    <!-- ── Part details & pricing (collapsible reference) ── -->
    <section class="px-4">
      <button
        type="button"
        class="w-full flex items-center justify-between py-3 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
        @click="showDetails = !showDetails"
      >
        <span>{{ t('part_details') }}</span>
        <ChevronDown
          class="h-4 w-4 transition-transform duration-200"
          :class="showDetails ? 'rotate-180' : ''"
        />
      </button>

      <div v-if="showDetails" class="pb-5">
        <!-- Part info -->
        <div class="flex gap-3 items-start mb-2">
          <img
            v-if="part.image"
            :src="part.image"
            class="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover"
            :alt="part.name"
          />
          <div
            v-else
            class="h-14 w-14 shrink-0 rounded-lg border border-slate-200 bg-slate-100 grid place-items-center text-slate-300 text-xl"
          >
            ▣
          </div>
          <div class="min-w-0 flex-1">
            <span
              class="inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 mb-1"
            >
              {{ part.category.name }}
            </span>
            <p v-if="part.location" class="text-xs text-slate-500 truncate">
              📍 {{ part.location }}
            </p>
          </div>
        </div>

        <p v-if="part.description" class="text-sm text-slate-600 leading-relaxed mb-3">
          {{ part.description }}
        </p>

        <div v-if="part.parameters?.length" class="flex flex-wrap gap-1 mb-3">
          <span
            v-for="v in part.parameters"
            :key="v.parameterId"
            class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
          >
            {{ v.parameter?.name }}: {{ v.value
            }}<template v-if="v.parameter?.unit"> {{ v.parameter.unit }}</template>
          </span>
        </div>

        <!-- Per-company pricing breakdown -->
        <template v-if="companyBreakdown.length">
          <button
            type="button"
            class="w-full flex items-center justify-between py-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors border-t border-slate-100"
            @click="showPricing = !showPricing"
          >
            <span class="flex items-center gap-1.5">
              <BarChart2 class="h-3.5 w-3.5" />
              {{ t('pricing_by_company') }}
              <span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                {{ companyBreakdown.length }}
              </span>
            </span>
            <ChevronDown
              class="h-3.5 w-3.5 transition-transform duration-200"
              :class="showPricing ? 'rotate-180' : ''"
            />
          </button>

          <div v-if="showPricing">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-xs text-slate-400 border-b border-slate-100">
                  <th class="text-left font-medium pb-1.5">{{ t('company') }}</th>
                  <th class="text-right font-medium pb-1.5">{{ t('total_quantity') }}</th>
                  <th class="text-right font-medium pb-1.5">{{ t('avg_price_per_piece') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in companyBreakdown"
                  :key="row.companyId"
                  class="border-b border-slate-50 last:border-0"
                >
                  <td class="py-1.5 text-slate-700">{{ row.companyName }}</td>
                  <td class="py-1.5 text-right text-slate-700">{{ formatQty(row.totalQty) }}</td>
                  <td class="py-1.5 text-right text-slate-700">{{ formatPrice(row.avgPrice) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </section>
  </div>

  <!-- History modal -->
  <PartStockHistoryModal
    v-model="showHistoryModal"
    :entries="entries"
    :part-name="part.name"
    :part-id="part.id"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X, Pencil, PlusCircle, MinusCircle, ChevronDown, BarChart2, Clock } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../../stores/auth.ts';
import { useStockEntriesStore } from '../../stores/stockEntriesStore.ts';
import { useStockSummary } from '../../composables/useStockSummary.ts';
import { formatQty, formatPrice } from '../../utils/formatters.ts';
import PartStockHistoryModal from './PartStockHistoryModal.vue';
import AddStockForm from './AddStockForm.vue';
import RemoveStockForm from './RemoveStockForm.vue';
import type { Part } from '../../types/parts.ts';
import type { Company } from '../../types/companies.ts';

const props = defineProps<{
  part: Part;
  companies: Company[];
}>();

defineEmits<{
  close: [];
  edit: [part: Part];
}>();

const { t } = useI18n();
const authStore = useAuthStore();
const stockEntriesStore = useStockEntriesStore();

const isAdmin = computed(() => authStore.isAdmin);

// ── Panel UI state ────────────────────────────────────────────────────────────

type StockTab = 'remove' | 'add';
const activeTab = ref<StockTab>('remove');
const showDetails = ref(true);
const showPricing = ref(false);
const showHistoryModal = ref(false);

// ── Stock entries + derived summary ───────────────────────────────────────────

const { entries, loading, totalQuantity, avgPricePerPiece, companyBreakdown } = useStockSummary(
  () => props.part.id,
  () => Number(props.part.pricePerPiece),
);

// Load entries when part changes; reset UI state.
watch(
  () => props.part.id,
  (id) => {
    stockEntriesStore.loadEntries(id); // cache-first
    activeTab.value = 'remove';
    showDetails.value = true;
    showPricing.value = false;
    showHistoryModal.value = false;
  },
  { immediate: true },
);
</script>
