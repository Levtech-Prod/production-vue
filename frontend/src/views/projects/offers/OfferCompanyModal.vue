<template>
  <BaseModal :model-value="visible" :title="t('add_offer_company')" size="sm" @update:model-value="close">
    <div class="space-y-3">
      <!-- Companies already on the sheet are listed but unselectable rather
           than hidden: "why isn't Farnell in here" is a worse question than
           seeing it greyed out and knowing it is already a column. -->
      <select v-model.number="companyId" class="input text-sm" :disabled="saving">
        <option :value="0" disabled>{{ t('select_company') }}</option>
        <option
          v-for="company in companies"
          :key="company.id"
          :value="company.id"
          :disabled="usedCompanyIds.includes(company.id)"
        >
          {{ company.name }}{{ usedCompanyIds.includes(company.id) ? ` — ${t('already_a_column')}` : '' }}
        </option>
      </select>

      <div class="flex gap-2">
        <input
          v-model="newCompanyName"
          class="input flex-1 text-sm"
          :placeholder="t('new_company_name')"
          :disabled="saving"
          @keydown.enter.prevent="createAndSelectCompany"
        />
        <button
          type="button"
          class="btn-secondary shrink-0"
          :disabled="creatingCompany || saving || !newCompanyName.trim()"
          @click="createAndSelectCompany"
        >
          {{ t('add') }}
        </button>
      </div>

      <p v-if="error" class="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-600">{{ error }}</p>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" :disabled="saving" @click="close">
        {{ t('cancel') }}
      </button>
      <button
        type="button"
        class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        :disabled="saving || companyId === 0"
        @click="submit"
      >
        {{ saving ? t('saving') : t('add') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../../components/modal/BaseModal.vue';
import { useCompaniesStore } from '../../../stores/companiesStore.ts';
import { translateApiError } from '../../../utils/apiError.ts';

/**
 * Pick a company to add as a column of the offer sheet (§6.5), with inline
 * creation — the same two controls `AddStockForm.vue` uses, for the same
 * reason: a supplier is usually first met while quoting, and sending the buyer
 * to the Companies page to write a name down loses the quote they were typing.
 *
 * The add itself is the parent's: it owns the grid the new column joins, and
 * the failure (a company already a column, say) belongs on the dialog that
 * caused it, which is why `saving` and `error` come in as props.
 */
const props = defineProps<{
  visible: boolean;
  /** Companies already on the sheet — offered, but not selectable. */
  usedCompanyIds: number[];
  saving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{ submit: [companyId: number]; close: [] }>();

const { t, te } = useI18n();
const companiesStore = useCompaniesStore();

const companies = computed(() => companiesStore.companies);
const companyId = ref(0);
const newCompanyName = ref('');
const creatingCompany = ref(false);
const createError = ref<string | null>(null);

const error = computed(() => props.error ?? createError.value);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    companyId.value = 0;
    newCompanyName.value = '';
    createError.value = null;
    // Cache-first inside the store: this costs a request once per session.
    void companiesStore.loadCompanies();
  },
);

async function createAndSelectCompany() {
  const name = newCompanyName.value.trim();
  if (!name || creatingCompany.value) return;
  creatingCompany.value = true;
  createError.value = null;
  try {
    const company = await companiesStore.createCompany({ name });
    companyId.value = company.id;
    newCompanyName.value = '';
  } catch (err) {
    createError.value = translateApiError(err, { t, te }, 'errors.save_company_failed');
  } finally {
    creatingCompany.value = false;
  }
}

function submit() {
  if (companyId.value > 0) emit('submit', companyId.value);
}

function close() {
  if (!props.saving) emit('close');
}
</script>
