<template>
  <TimelineItem
    :title="firmware.name"
    :dot-class="statusDot(firmware.status)"
    :badge-class="statusBadgeClass(firmware.status)"
    :badge-label="t(`firmware_status.${firmware.status}`)"
    :meta="`${formatDate(firmware.createdAt)} · ${firmware.createdByName || '—'}`"
    :is-selected="isSelected"
    :is-last="isLast"
    @select="emit('select')"
  >
    <template v-if="firmware.files.length > 0" #footer>
      <span class="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
        <Paperclip class="h-3 w-3 shrink-0" />
        {{ t('n_files', firmware.files.length) }}
      </span>
    </template>
  </TimelineItem>
</template>

<script setup lang="ts">
import { Paperclip } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import TimelineItem from '../TimelineItem.vue';
import { formatDate } from '../../../../utils/formatters.ts';
import { statusBadgeClass, statusDot } from '../../../../utils/statusColors.ts';
import type { Firmware } from '../../../../types/firmware.ts';

defineProps<{
  firmware: Firmware;
  isSelected: boolean;
  isLast: boolean;
}>();

const emit = defineEmits<{ (e: 'select'): void }>();

const { t } = useI18n();
</script>
