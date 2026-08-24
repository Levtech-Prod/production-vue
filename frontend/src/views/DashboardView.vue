<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div>
    <div class="grid gap-4 md:grid-cols-3">
      <div class="card p-5">
        <div class="text-sm text-slate-500">{{ t('users') }}</div>
        <div class="mt-2 text-2xl font-bold">
          {{ t('admin') }} / {{ t('client') }}
        </div>
      </div>
      <div class="card p-5">
        <div class="text-sm text-slate-500">{{ t('stock') }}</div>
        <div class="mt-2 text-2xl font-bold">{{ t('categories') }}</div>
      </div>
      <div class="card p-5">
        <div class="text-sm text-slate-500">{{ t('parts') }}</div>
        <div class="mt-2 text-2xl font-bold">{{ t('dynamic_parameters') }}</div>
      </div>
    </div>
  </div>
</template>
