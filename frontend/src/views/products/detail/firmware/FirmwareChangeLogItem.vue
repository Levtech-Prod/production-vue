<template>
  <li class="relative">
    <!-- Rail: dot plus the line down to the next entry, hidden on the last
         item so the timeline ends cleanly. -->
    <span
      v-if="!isLast"
      class="absolute left-[13px] top-5 bottom-0 w-px bg-slate-200"
      aria-hidden="true"
    />

    <button
      type="button"
      class="relative flex w-full items-start gap-2 rounded-r-md border-l-2 py-2 pl-2 pr-2 text-left transition-colors"
      :class="
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'
      "
      :aria-current="isSelected ? 'true' : undefined"
      @click="emit('select')"
    >
      <span
        class="mt-1 h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
        :class="statusDot(firmware.status)"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5">
          <span
            class="truncate text-sm font-semibold"
            :class="isSelected ? 'text-blue-700' : 'text-slate-800'"
          >
            {{ firmware.name }}
          </span>
          <span
            class="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            :class="statusBadgeClass(firmware.status)"
          >
            {{ t(`firmware_status.${firmware.status}`) }}
          </span>
        </span>

        <span class="mt-0.5 block truncate text-[11px] text-slate-400">
          {{ formatDate(firmware.createdAt) }} · {{ firmware.createdByName || '—' }}
        </span>

        <span
          v-if="firmware.files.length > 0"
          class="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400"
        >
          <Paperclip class="h-3 w-3 shrink-0" />
          {{ t('firmware_file_count', firmware.files.length) }}
        </span>
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { Paperclip } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatDate } from '../../../../utils/formatters.ts';
import { statusBadgeClass, statusDot } from './firmwareHelpers.ts';
import type { Firmware } from '../../../../types/firmware.ts';

defineProps<{
  firmware: Firmware;
  isSelected: boolean;
  isLast: boolean;
}>();

const emit = defineEmits<{ (e: 'select'): void }>();

const { t } = useI18n();
</script>
