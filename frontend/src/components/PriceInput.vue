<!--
  Price entry with a currency selector. The amount is whatever the user typed;
  the currency tells the backend how to interpret it. RON amounts are converted
  to canonical EUR server-side using the BNR rate for the entry date. Two
  independent v-models keep the parent free to shape its own payload.

  Usage:
    <PriceInput v-model:amount="form.amount" v-model:currency="form.currency" />
-->
<template>
  <div class="flex gap-1.5">
    <!--
      `.input` in style.css is unlayered CSS (`width: 100%`), so Tailwind width
      utilities can't override it. We use inline styles (which outrank it) instead
      of a `w-*` class. The select is sized to its content (`width: auto`) rather
      than a fixed narrow width — a very narrow fixed-width native <select> can
      mis-anchor and dismiss its own popup in some browsers.
    -->
    <input
      :value="amount"
      type="number"
      min="0"
      step="0.0001"
      class="input text-sm"
      style="flex: 1 1 0%; min-width: 0"
      :placeholder="placeholder ?? t('price_per_piece')"
      @input="onAmount"
    />
    <select
      :value="currency"
      class="input text-sm"
      style="width: auto; flex: 0 0 auto"
      :aria-label="t('currency')"
      @change="onCurrency"
    >
      <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { EntryCurrency } from '../types/parts.ts';

const CURRENCIES: EntryCurrency[] = ['EUR', 'RON'];

defineProps<{
  amount: number | null;
  currency: EntryCurrency;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:amount': [value: number | null];
  'update:currency': [value: EntryCurrency];
}>();

const { t } = useI18n();

function onAmount(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  emit('update:amount', raw === '' ? null : Number(raw));
}

function onCurrency(e: Event) {
  emit('update:currency', (e.target as HTMLSelectElement).value as EntryCurrency);
}
</script>
