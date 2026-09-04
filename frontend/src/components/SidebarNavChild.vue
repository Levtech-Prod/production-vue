<template>
  <RouterLink v-if="!disabled" class="nav" :to="to!">
    <span class="nav-link">{{ label }}</span>
  </RouterLink>
  <span v-else class="nav disabled" :title="t('coming_soon')">
    <span class="nav-link">{{ label }}</span>
  </span>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{
  to?: string;
  label: string;
  disabled?: boolean;
}>();

const { t } = useI18n();
</script>
