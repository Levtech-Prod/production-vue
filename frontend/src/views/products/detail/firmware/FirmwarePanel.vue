<template>
  <!-- Three regions: the version change log down the left, the selected
       version's details on the right, its files along the bottom. The modals
       live in ProductDetailView with every other modal on the page. -->
  <div class="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto]">
    <div class="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2">
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        @click="emit('back')"
      >
        <ChevronLeft class="h-3.5 w-3.5" /> {{ t('tab_documents') }}
      </button>
      <span class="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
        {{ title }}
      </span>
    </div>

    <div class="grid min-h-0 grid-cols-[16rem_1fr]">
      <FirmwareChangeLog
        :firmwares="firmwares"
        :selected-id="selectedId"
        :loading="loading"
        :can-edit="canEdit"
        @select="emit('select', $event)"
        @create="emit('create')"
      />
      <FirmwareDetails
        :firmware="selected"
        :has-firmwares="firmwares.length > 0"
        :revision-label="revisionLabel"
        :can-edit="canEdit"
        :saving="saving"
        @create="emit('create')"
        @edit="emit('edit', $event)"
        @delete="emit('delete', $event)"
        @set-production="emit('set-production', $event)"
      />
    </div>

    <FirmwareFiles
      :firmware="selected"
      :has-firmwares="firmwares.length > 0"
      :can-edit="canEdit"
      :uploading="uploading"
      @upload="emit('upload', $event)"
      @delete-file="emit('delete-file', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import FirmwareChangeLog from './FirmwareChangeLog.vue';
import FirmwareDetails from './FirmwareDetails.vue';
import FirmwareFiles from './FirmwareFiles.vue';
import type { Firmware, FirmwareFile } from '../../../../types/firmware.ts';

defineProps<{
  title: string;
  revisionLabel: string;
  firmwares: Firmware[];
  selected: Firmware | null;
  selectedId: number | null;
  loading: boolean;
  saving: boolean;
  uploading: boolean;
  canEdit: boolean;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'select', firmwareId: number): void;
  (e: 'create'): void;
  (e: 'edit', firmware: Firmware): void;
  (e: 'delete', firmware: Firmware): void;
  (e: 'set-production', firmware: Firmware): void;
  (e: 'upload', files: File[]): void;
  (e: 'delete-file', file: FirmwareFile): void;
}>();

const { t } = useI18n();
</script>
