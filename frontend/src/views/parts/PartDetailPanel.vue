<template>
  <!-- No flex/h-full here — the parent card is the scroll container -->
  <div>
    <!-- ── Sticky header (sticks inside the card's own scroll) ── -->
    <div
      class="sticky top-0 z-10 bg-white border-b border-slate-200 flex items-center gap-2 px-4 py-3"
    >
      <!-- Name + code -->
      <div class="min-w-0 flex-1">
        <h2 class="font-semibold text-slate-900 truncate leading-tight">
          {{ part.name }}
        </h2>
        <span class="text-xs font-mono text-slate-400">{{ part.code }}</span>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-0.5 shrink-0">
        <button
          v-if="entries.length"
          type="button"
          class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          :title="t('stock_history')"
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

    <!-- ── Part info ── -->
    <section class="px-4 pt-4 pb-3 border-b border-slate-100">
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

      <p
        v-if="part.description"
        class="text-sm text-slate-600 leading-relaxed mb-3"
      >
        {{ part.description }}
      </p>

      <div v-if="part.parameters?.length" class="flex flex-wrap gap-1">
        <span
          v-for="v in part.parameters"
          :key="v.parameterId"
          class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
        >
          {{ v.parameter?.name }}: {{ v.value
          }}<template v-if="v.parameter?.unit">
            {{ v.parameter.unit }}</template
          >
        </span>
      </div>
    </section>

    <!-- ── Stock & Pricing ── -->
    <section class="border-b border-slate-100 px-4 pt-4 pb-3">
      <h3
        class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3"
      >
        {{ t('stock_and_pricing') }}
      </h3>

      <!-- Loading state -->
      <div
        v-if="loadingEntries"
        class="flex items-center gap-2 text-sm text-slate-400 py-2"
      >
        <svg
          class="animate-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
        {{ t('loading') }}
      </div>

      <template v-else>
        <!-- Summary cards (always visible) -->
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div class="text-xs text-slate-400 mb-0.5">
              {{ t('total_quantity') }}
            </div>
            <div class="text-2xl font-bold text-slate-900">
              {{ formatQty(totalQuantity) }}
            </div>
          </div>
          <div class="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div class="text-xs text-slate-400 mb-0.5">
              {{ t('avg_price_per_piece') }}
            </div>
            <div class="text-2xl font-bold text-slate-900">
              {{ formatPrice(avgPricePerPiece) }}
            </div>
          </div>
        </div>

        <!-- Per-company breakdown — collapsible -->
        <template v-if="companyBreakdown.length">
          <button
            type="button"
            class="w-full flex items-center justify-between py-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            @click="showPricing = !showPricing"
          >
            <span class="flex items-center gap-1.5">
              <BarChart2 class="h-3.5 w-3.5" />
              {{ t('pricing_by_company') }}
              <span
                class="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600"
              >
                {{ companyBreakdown.length }}
              </span>
            </span>
            <ChevronDown
              class="h-3.5 w-3.5 transition-transform duration-200"
              :class="showPricing ? 'rotate-180' : ''"
            />
          </button>

          <div v-if="showPricing" class="mb-3">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-xs text-slate-400 border-b border-slate-100">
                  <th class="text-left font-medium pb-1.5">
                    {{ t('company') }}
                  </th>
                  <th class="text-right font-medium pb-1.5">
                    {{ t('total_quantity') }}
                  </th>
                  <th class="text-right font-medium pb-1.5">
                    {{ t('avg_price_per_piece') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in companyBreakdown"
                  :key="row.companyId"
                  class="border-b border-slate-50 last:border-0"
                >
                  <td class="py-1.5 text-slate-700">{{ row.companyName }}</td>
                  <td class="py-1.5 text-right text-slate-700">
                    {{ formatQty(row.totalQty) }}
                  </td>
                  <td class="py-1.5 text-right text-slate-700">
                    {{ formatPrice(row.avgPrice) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <hr class="border-slate-200" />

        <!-- Add Stock Entry form -->
        <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 mt-3">
          <h4 class="text-sm font-medium text-slate-700 mb-3">
            {{ t('add_stock_entry') }}
          </h4>
          <div class="space-y-2">
            <!-- Company selector + inline create -->
            <div class="flex gap-2">
              <select
                v-model.number="form.companyId"
                class="input flex-1 text-sm"
              >
                <option :value="0" disabled>{{ t('select_company') }}</option>
                <option v-for="c in companies" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-500 hover:bg-slate-100 transition-colors"
                :title="t('add_company')"
                @click="showNewCompany = !showNewCompany"
              >
                <Plus class="h-4 w-4" />
              </button>
            </div>

            <!-- Inline new company -->
            <div v-if="showNewCompany" class="flex gap-2">
              <input
                v-model="newCompanyName"
                class="input flex-1 text-sm"
                :placeholder="t('new_company_name')"
                @keydown.enter.prevent="createAndSelectCompany"
              />
              <button
                type="button"
                class="shrink-0 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
                :disabled="creatingCompany || !newCompanyName.trim()"
                @click="createAndSelectCompany"
              >
                {{ t('add') }}
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div class="flex flex-col gap-1">
                <label class="text-xs text-slate-500">{{
                  t('quantity')
                }}</label>
                <input
                  v-model.number="form.quantity"
                  type="number"
                  min="1"
                  step="1"
                  class="input text-sm"
                  :placeholder="t('quantity')"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-slate-500">{{
                  t('price_per_piece')
                }}</label>
                <input
                  v-model.number="form.pricePerPiece"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input text-sm"
                  :placeholder="t('price_per_piece')"
                />
              </div>
            </div>

            <div
              v-if="formError"
              class="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5"
            >
              {{ formError }}
            </div>

            <button
              type="button"
              class="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60"
              :disabled="savingEntry || !canSubmit"
              @click="submitEntry"
            >
              {{ savingEntry ? t('saving') : t('save_stock_entry') }}
            </button>
          </div>
        </div>
      </template>
    </section>
  </div>

  <!-- History modal -->
  <PartStockHistoryModal
    v-model="showHistoryModal"
    :entries="entries"
    :part-name="part.name"
  />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  X,
  Pencil,
  Plus,
  ChevronDown,
  BarChart2,
  Clock,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../../stores/auth.ts';
import { useStockEntriesStore } from '../../stores/stockEntriesStore.ts';
import { usePartsStore } from '../../stores/partsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { useCompaniesStore } from '../../stores/companiesStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { formatQty, formatPrice } from '../../utils/formatters.ts';
import PartStockHistoryModal from './PartStockHistoryModal.vue';
import type { Part } from '../../types/parts.ts';
import type { Company } from '../../types/companies.ts';

const props = defineProps<{
  part: Part;
  companies: Company[];
}>();

const emit = defineEmits<{
  close: [];
  edit: [part: Part];
}>();

const { t, te } = useI18n();
const authStore = useAuthStore();
const stockEntriesStore = useStockEntriesStore();
const partsStore = usePartsStore();
const notificationStore = useNotificationStore();
const companiesStore = useCompaniesStore();

const isAdmin = computed(() => authStore.isAdmin);

// ── Collapsible sections + history modal ─────────────────────────────────────

const showPricing = ref(false);
const showHistoryModal = ref(false);

// ── Entries ──────────────────────────────────────────────────────────────────

const entries = computed(() => stockEntriesStore.getEntries(props.part.id));
const loadingEntries = computed(() =>
  stockEntriesStore.isLoading(props.part.id),
);
const savingEntry = computed(() => stockEntriesStore.savingEntry);

// Load entries when part changes; reset UI state so each part starts fresh.
watch(
  () => props.part.id,
  (id) => {
    stockEntriesStore.loadEntries(id); // cache-first — no extra call if already loaded
    showPricing.value = false;
    showHistoryModal.value = false;
  },
  { immediate: true },
);

// ── Computed stock summary ───────────────────────────────────────────────────

const totalQuantity = computed(() =>
  entries.value.reduce((sum, e) => sum + Number(e.quantity), 0),
);

const avgPricePerPiece = computed(() => {
  const total = entries.value.reduce((sum, e) => sum + Number(e.quantity), 0);
  if (total === 0) return Number(props.part.pricePerPiece);
  return (
    entries.value.reduce(
      (sum, e) => sum + Number(e.pricePerPiece) * Number(e.quantity),
      0,
    ) / total
  );
});

/** Weighted avg price per company, sorted alphabetically. */
const companyBreakdown = computed(() => {
  const map = new Map<
    number,
    {
      companyId: number;
      companyName: string;
      totalQty: number;
      totalValue: number;
    }
  >();
  for (const e of entries.value) {
    const existing = map.get(e.company.id);
    if (existing) {
      existing.totalQty += Number(e.quantity);
      existing.totalValue += Number(e.pricePerPiece) * Number(e.quantity);
    } else {
      map.set(e.company.id, {
        companyId: e.company.id,
        companyName: e.company.name,
        totalQty: Number(e.quantity),
        totalValue: Number(e.pricePerPiece) * Number(e.quantity),
      });
    }
  }
  return [...map.values()]
    .sort((a, b) => a.companyName.localeCompare(b.companyName))
    .map((row) => ({
      ...row,
      avgPrice: row.totalQty > 0 ? row.totalValue / row.totalQty : 0,
    }));
});

// ── Add stock entry form ─────────────────────────────────────────────────────

const form = reactive({
  companyId: 0,
  quantity: null as number | null,
  pricePerPiece: null as number | null,
});
const formError = ref<string | null>(null);
const showNewCompany = ref(false);
const newCompanyName = ref('');
const creatingCompany = ref(false);

const canSubmit = computed(
  () =>
    form.companyId > 0 &&
    form.quantity != null &&
    Number.isInteger(form.quantity) &&
    form.quantity >= 1 &&
    form.pricePerPiece != null &&
    form.pricePerPiece >= 0,
);

async function createAndSelectCompany() {
  const name = newCompanyName.value.trim();
  if (!name) return;
  creatingCompany.value = true;
  try {
    const company = await companiesStore.createCompany({ name });
    form.companyId = company.id;
    newCompanyName.value = '';
    showNewCompany.value = false;
  } catch (err) {
    notificationStore.showToast(
      translateApiError(err, { t, te }, 'errors.save_company_failed'),
      'error',
    );
  } finally {
    creatingCompany.value = false;
  }
}

async function submitEntry() {
  formError.value = null;
  if (!canSubmit.value) {
    formError.value = t('errors.fill_required_fields');
    return;
  }

  try {
    await stockEntriesStore.addEntry({
      partId: props.part.id,
      companyId: form.companyId,
      quantity: Math.round(form.quantity!),
      pricePerPiece: form.pricePerPiece!,
    });

    partsStore.updatePartStockSummary(
      props.part.id,
      stockEntriesStore.getEntries(props.part.id),
    );

    notificationStore.showToast(t('success.save_stock_entry'), 'success');

    // Keep company selected for quick multi-entry; only clear amounts
    form.quantity = null;
    form.pricePerPiece = null;
  } catch (err) {
    formError.value = translateApiError(
      err,
      { t, te },
      'errors.save_stock_entry_failed',
    );
  }
}
</script>
