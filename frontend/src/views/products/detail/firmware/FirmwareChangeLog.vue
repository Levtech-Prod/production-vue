<template>
  <div class="flex min-h-0 flex-col border-r border-slate-100">
    <div class="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-1.5">
      <span class="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {{ t('firmware_change_log') }}
      </span>
      <!-- Runs over the already-loaded list, so it triggers no request. -->
      <select
        v-model="statusFilter"
        class="min-w-0 shrink rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
        :aria-label="t('filter_by_status')"
      >
        <option value="all">{{ t('all_statuses') }}</option>
        <option v-for="status in FIRMWARE_STATUSES" :key="status" :value="status">
          {{ t(`firmware_status.${status}`) }}
        </option>
      </select>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
      <p v-if="loading" class="py-10 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </p>
      <p v-else-if="!firmwares.length" class="py-10 text-center text-sm text-slate-400">
        {{ t('no_firmware_yet') }}
      </p>
      <p v-else-if="!visible.length" class="py-10 text-center text-sm text-slate-400">
        {{ t('no_firmware_for_filter') }}
      </p>
      <ul v-else>
        <FirmwareChangeLogItem
          v-for="(firmware, i) in visible"
          :key="firmware.id"
          :firmware="firmware"
          :is-selected="firmware.id === selectedId"
          :is-last="i === visible.length - 1"
          @select="emit('select', firmware.id)"
        />
      </ul>
    </div>

    <div v-if="canEdit" class="shrink-0 border-t border-slate-100 p-2">
      <button
        type="button"
        class="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        @click="emit('create')"
      >
        <Plus class="h-3.5 w-3.5" /> {{ t('add_firmware') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import FirmwareChangeLogItem from './FirmwareChangeLogItem.vue';
import { FIRMWARE_STATUSES } from '../../../../types/firmware.ts';
import type { Firmware, FirmwareStatus } from '../../../../types/firmware.ts';

const props = defineProps<{
  firmwares: Firmware[];
  selectedId: number | null;
  loading: boolean;
  canEdit: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', firmwareId: number): void;
  (e: 'create'): void;
}>();

const { t } = useI18n();

const statusFilter = ref<FirmwareStatus | 'all'>('all');

// The list arrives newest-first from the API; only filtering happens here.
const visible = computed(() =>
  statusFilter.value === 'all'
    ? props.firmwares
    : props.firmwares.filter((f) => f.status === statusFilter.value),
);
</script>
