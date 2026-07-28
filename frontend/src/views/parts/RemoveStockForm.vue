<template>
  <div
    v-if="maxQuantity === 0"
    class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400"
  >
    {{ t('no_stock_entries') }}
  </div>

  <div v-else class="space-y-2">
    <div class="flex flex-col gap-1">
      <label class="text-xs text-slate-500">
        {{ t('quantity') }}
        <span class="text-slate-400">(max {{ formatQty(maxQuantity) }})</span>
      </label>
      <input
        v-model.number="form.quantity"
        type="number"
        min="1"
        step="1"
        :max="Math.floor(maxQuantity)"
        class="input text-sm"
        :placeholder="t('quantity')"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs text-slate-500">{{ t('note') }}</label>
      <textarea
        v-model="form.note"
        rows="2"
        class="input text-sm resize-none"
        :placeholder="t('note')"
      />
    </div>

    <div v-if="formError" class="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">
      {{ formError }}
    </div>

    <button
      type="button"
      class="w-full rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 active:bg-red-800 transition-colors disabled:opacity-60"
      :disabled="savingEntry || !canRemove"
      @click="submit"
    >
      {{ savingEntry ? t('saving') : t('remove_from_stock') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStockEntriesStore } from '../../stores/stockEntriesStore.ts';
import { usePartsStore } from '../../stores/partsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { formatQty } from '../../utils/formatters.ts';
import type { Part } from '../../types/parts.ts';

const props = defineProps<{
  part: Part;
  maxQuantity: number;
}>();

const { t, te } = useI18n();
const stockEntriesStore = useStockEntriesStore();
const partsStore = usePartsStore();
const notificationStore = useNotificationStore();

const savingEntry = computed(() => stockEntriesStore.savingEntry);

const form = reactive({
  quantity: null as number | null,
  note: '',
});
const formError = ref<string | null>(null);

const canRemove = computed(
  () =>
    form.quantity != null &&
    Number.isInteger(form.quantity) &&
    form.quantity >= 1 &&
    form.quantity <= props.maxQuantity &&
    form.note.trim().length > 0 &&
    props.maxQuantity > 0,
);

async function submit() {
  formError.value = null;
  if (!canRemove.value) {
    formError.value = t('errors.fill_required_fields');
    return;
  }

  try {
    await stockEntriesStore.addEntry({
      type: 'removed',
      partId: props.part.id,
      quantity: Math.round(form.quantity!),
      note: form.note.trim(),
    });

    // addEntry patches the drawn-down received rows into the cache, so the
    // summary can be recomputed locally without a refetch.
    partsStore.updatePartStockSummary(props.part.id, stockEntriesStore.getEntries(props.part.id));
    notificationStore.showToast(t('success.remove_from_stock'), 'success');

    form.quantity = null;
    form.note = '';
  } catch (err) {
    formError.value = translateApiError(err, { t, te }, 'errors.save_stock_removal_failed');
  }
}
</script>
