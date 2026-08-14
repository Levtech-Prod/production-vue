<template>
  <TimelineItem
    :title="revision.label"
    :dot-class="statusDot(revision.status)"
    :badge-class="statusBadgeClass(revision.status)"
    :badge-label="t(`revision_status.${revision.status}`)"
    :meta="`${formatDate(revision.createdAt)} · ${revision.createdByName || '—'}`"
    :is-selected="isActive"
    :is-last="isLast"
    @select="emit('select')"
  >
    <template v-if="isDefault" #title-badge>
      <Star class="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" :title="t('default_revision')" />
    </template>
  </TimelineItem>
</template>

<script setup lang="ts">
import { Star } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import TimelineItem from '../TimelineItem.vue';
import { formatDate } from '../../../../utils/formatters.ts';
import { statusBadgeClass, statusDot } from '../../../../utils/statusColors.ts';
import type { ProductRevision } from '../../../../types/products.ts';

defineProps<{
  revision: ProductRevision;
  isActive: boolean;
  isDefault: boolean;
  isLast: boolean;
}>();

const emit = defineEmits<{ (e: 'select'): void }>();

const { t } = useI18n();
</script>
