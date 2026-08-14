<template>
  <div class="flex max-h-64 min-h-0 flex-col border-t border-slate-100">
    <div class="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
      <h4 class="text-sm font-semibold text-slate-700">{{ t('firmware_files') }}</h4>
      <span v-if="firmware" class="text-xs text-slate-400">
        {{ t('n_files', firmware.files.length) }}
      </span>

      <label
        v-if="firmware && canEdit"
        class="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
        :class="{ 'pointer-events-none opacity-50': uploading }"
        :title="t('firmware_any_extension_hint')"
      >
        <Upload class="h-3.5 w-3.5" />
        {{ uploading ? t('uploading') : t('upload_file') }}
        <!-- No `accept`: every extension is allowed for firmware. -->
        <input type="file" class="sr-only" multiple @change="onPick" />
      </label>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
      <p v-if="!hasFirmwares" class="py-4 text-center text-sm text-slate-400">
        {{ t('no_firmware_yet_hint') }}
      </p>
      <p v-else-if="!firmware" class="py-4 text-center text-sm text-slate-400">
        {{ t('select_firmware_hint') }}
      </p>
      <p v-else-if="!firmware.files.length" class="py-4 text-center text-sm text-slate-400">
        {{ t('no_firmware_files') }}
      </p>

      <ul
        v-else
        class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8"
      >
        <li
          v-for="file in firmware.files"
          :key="file.id"
          class="group relative flex flex-col items-center gap-0.5 rounded-lg border border-slate-200 px-1.5 pb-1.5 pt-2.5 transition-colors hover:border-slate-300"
        >
          <!-- Uploading an executable is allowed, but it shouldn't be silent —
               the warning is for whoever downloads it. -->
          <span
            v-if="isExecutableFile(file.originalName)"
            class="absolute left-1 top-1 text-amber-500"
            :title="t('firmware_executable_hint')"
          >
            <TriangleAlert class="h-3 w-3" />
            <span class="sr-only">{{ t('firmware_executable') }}</span>
          </span>

          <button
            v-if="canEdit"
            type="button"
            class="absolute right-0.5 top-0.5 rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            :title="t('delete')"
            @click="emit('delete-file', file)"
          >
            <X class="h-3 w-3" />
          </button>

          <FirmwareFileIcon :file-name="file.originalName" />

          <p
            class="w-full truncate text-center text-[10px] font-medium leading-tight text-slate-700"
            :title="file.originalName"
          >
            {{ file.originalName }}
          </p>
          <p class="text-[9px] leading-tight text-slate-400">{{ formatBytes(file.sizeBytes) }}</p>

          <button
            type="button"
            class="mt-1 w-full rounded-md border border-slate-200 py-0.5 text-slate-400 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
            :title="t('download')"
            @click="download(file.downloadUrl, file.originalName)"
          >
            <Download class="mx-auto h-3 w-3" />
            <span class="sr-only">{{ t('download') }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Download, TriangleAlert, Upload, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatBytes } from '../../../../utils/formatters.ts';
import { useFileDownload } from '../../../../composables/useFileDownload.ts';
import FirmwareFileIcon from './FirmwareFileIcon.vue';
import { isExecutableFile } from './firmwareHelpers.ts';
import type { Firmware, FirmwareFile } from '../../../../types/firmware.ts';

defineProps<{
  firmware: Firmware | null;
  hasFirmwares: boolean;
  canEdit: boolean;
  uploading: boolean;
}>();

const emit = defineEmits<{
  (e: 'upload', files: File[]): void;
  (e: 'delete-file', file: FirmwareFile): void;
}>();

const { t } = useI18n();
const { download } = useFileDownload();

/** Read the picked files, then reset the input so the same selection can be
 *  re-picked later (the change event won't fire for an identical value). */
function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length > 0) emit('upload', files);
}
</script>
