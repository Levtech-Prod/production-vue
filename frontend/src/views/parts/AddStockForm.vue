<template>
  <div class="space-y-2">
    <div class="flex gap-2">
      <select v-model.number="form.companyId" class="input flex-1 text-sm">
        <option :value="0" disabled>{{ t('select_company') }}</option>
        <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
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

    <div class="grid grid-cols-3 gap-2">
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-xs text-slate-500">{{ t('quantity') }}</label>
        <input
          v-model.number="form.quantity"
          type="number"
          min="1"
          step="1"
          class="input min-w-0 text-sm"
          :placeholder="t('quantity')"
        />
      </div>
      <div class="col-span-2 flex min-w-0 flex-col gap-1">
        <label class="text-xs text-slate-500">{{ t('price_per_piece') }}</label>
        <PriceInput
          v-model:amount="form.priceAmount"
          v-model:currency="form.priceCurrency"
        />
      </div>
    </div>

    <div v-if="formError" class="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">
      {{ formError }}
    </div>

    <button
      type="button"
      class="w-full rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 transition-colors disabled:opacity-60"
      :disabled="savingEntry || !canSubmit"
      @click="submit"
    >
      {{ savingEntry ? t('saving') : t('save_stock_entry') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import PriceInput from '../../components/PriceInput.vue';
import { useStockEntriesStore } from '../../stores/stockEntriesStore.ts';
import { usePartsStore } from '../../stores/partsStore.ts';
import { useCompaniesStore } from '../../stores/companiesStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import type { Part, EntryCurrency } from '../../types/parts.ts';
import type { Company } from '../../types/companies.ts';

const props = defineProps<{
  part: Part;
  companies: Company[];
}>();

const { t, te } = useI18n();
const stockEntriesStore = useStockEntriesStore();
const partsStore = usePartsStore();
const companiesStore = useCompaniesStore();
const notificationStore = useNotificationStore();

const savingEntry = computed(() => stockEntriesStore.savingEntry);

const form = reactive({
  companyId: 0,
  quantity: null as number | null,
  priceAmount: null as number | null,
  priceCurrency: 'EUR' as EntryCurrency,
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
    form.priceAmount != null &&
    form.priceAmount >= 0,
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

async function submit() {
  formError.value = null;
  if (!canSubmit.value) {
    formError.value = t('errors.fill_required_fields');
    return;
  }

  try {
    await stockEntriesStore.addEntry({
      type: 'received',
      partId: props.part.id,
      companyId: form.companyId,
      quantity: Math.round(form.quantity!),
      pricePerPiece: { amount: form.priceAmount!, currency: form.priceCurrency },
    });

    partsStore.updatePartStockSummary(props.part.id, stockEntriesStore.getEntries(props.part.id));
    notificationStore.showToast(t('success.save_stock_entry'), 'success');

    form.quantity = null;
    form.priceAmount = null;
  } catch (err) {
    formError.value = translateApiError(err, { t, te }, 'errors.save_stock_entry_failed');
  }
}
</script>
