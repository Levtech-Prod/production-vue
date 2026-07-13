<template>
  <div class="flex items-start justify-center pt-1">
    <span
      v-if="status === 'unchanged'"
      class="h-2.5 w-2.5 rounded-full bg-emerald-500"
      :title="t('compare_status.unchanged')"
    ></span>
    <span
      v-else
      class="grid h-4 w-4 place-items-center rounded-full bg-red-100 text-[10px] font-bold leading-none text-red-700"
      :title="status ? t('compare_status.' + status) : ''"
    >
      {{ statusSign(status) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { CompareStatus } from '../../../types/products.ts';
import { statusSign } from './compareHelpers.ts';

defineProps<{ status: CompareStatus | null }>();

const { t } = useI18n();
</script>
