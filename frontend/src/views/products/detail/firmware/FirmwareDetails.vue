<template>
  <div class="min-h-0 overflow-y-auto px-4 py-3">
    <!-- Nothing exists yet. Files live INSIDE a version, so this is the one
         place that has to explain the order of operations — without it the
         panel reads as broken rather than empty. -->
    <div v-if="!hasFirmwares" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
        <Cpu class="h-6 w-6" />
      </span>
      <p class="text-sm font-semibold text-slate-700">{{ t('no_firmware_yet') }}</p>
      <p class="max-w-xs text-xs text-slate-500">{{ t('no_firmware_yet_hint') }}</p>
      <button
        v-if="canEdit"
        type="button"
        class="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        @click="emit('create')"
      >
        <Plus class="h-4 w-4" /> {{ t('add_first_firmware') }}
      </button>
    </div>

    <!-- Versions exist but none is selected — only reachable via the filter. -->
    <p v-else-if="!firmware" class="py-10 text-center text-sm text-slate-400">
      {{ t('select_firmware_hint') }}
    </p>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h3 class="min-w-0 truncate text-lg font-semibold text-slate-800">
          {{ firmware.name }}
        </h3>
        <span
          class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
          :class="statusBadgeClass(firmware.status)"
        >
          {{ t(`firmware_status.${firmware.status}`) }}
        </span>

        <div v-if="canEdit" class="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            @click="emit('edit', firmware)"
          >
            <Pencil class="h-3.5 w-3.5" /> {{ t('edit') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            @click="emit('delete', firmware)"
          >
            <Trash2 class="h-3.5 w-3.5" /> {{ t('delete') }}
          </button>
        </div>
      </div>

      <section class="rounded-xl border border-slate-200">
        <h4 class="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          {{ t('firmware_version_info') }}
        </h4>

        <!-- Details left, status box right, a rule between them. The divider is
             a border on the right-hand column rather than a `divide-x`, so it
             disappears with the same breakpoint that stacks the two. -->
        <div class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-0">
          <dl
            class="grid grid-cols-[8.5rem_minmax(0,1fr)] content-start gap-x-3 gap-y-2.5 text-sm lg:pr-5"
          >
            <dt class="text-slate-500">{{ t('firmware_version') }}</dt>
            <dd class="min-w-0 truncate font-medium text-slate-800">{{ firmware.name }}</dd>

            <dt class="text-slate-500">{{ t('field_status') }}</dt>
            <dd class="flex items-center gap-1.5 text-slate-800">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="statusDot(firmware.status)"
                aria-hidden="true"
              />
              {{ t(`firmware_status.${firmware.status}`) }}
            </dd>

            <dt class="text-slate-500">{{ t('firmware_created_at') }}</dt>
            <dd class="text-slate-800">{{ formatDate(firmware.createdAt) }}</dd>

            <dt class="text-slate-500">{{ t('firmware_created_by') }}</dt>
            <dd class="min-w-0 truncate text-slate-800">{{ firmware.createdByName || '—' }}</dd>

            <dt class="text-slate-500">{{ t('firmware_revision') }}</dt>
            <dd class="min-w-0 truncate text-slate-800">{{ revisionLabel }}</dd>

            <dt class="text-slate-500">{{ t('firmware_release_notes') }}</dt>
            <!-- v-text, not an interpolation: `whitespace-pre-wrap` is needed for
                 multi-line notes, and it would otherwise also render this
                 template's own newline and indentation. -->
            <dd
              class="min-w-0 whitespace-pre-wrap break-words"
              :class="firmware.releaseNotes ? 'text-slate-800' : 'text-slate-400'"
              v-text="firmware.releaseNotes || t('no_release_notes')"
            />
          </dl>

          <div class="lg:border-l lg:border-slate-100 lg:pl-5">
            <!-- Rendered in both states so the pane doesn't jump in height when
                 a version is promoted. -->
            <div
              class="rounded-xl border px-3 py-3"
              :class="
                isProduction ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'
              "
            >
              <p class="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Crown
                  class="h-4 w-4 shrink-0"
                  :class="isProduction ? 'text-emerald-600' : 'text-slate-400'"
                />
                {{ isProduction ? t('firmware_is_production') : t('firmware_not_production') }}
              </p>
              <p class="mt-1.5 text-xs leading-relaxed text-slate-500">
                {{
                  isProduction ? t('firmware_is_production_hint') : t('firmware_not_production_hint')
                }}
              </p>
              <button
                v-if="canEdit && !isProduction"
                type="button"
                class="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="saving"
                @click="emit('set-production', firmware)"
              >
                {{ t('set_as_production') }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Cpu, Crown, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatDate } from '../../../../utils/formatters.ts';
import { statusBadgeClass, statusDot } from './firmwareHelpers.ts';
import type { Firmware } from '../../../../types/firmware.ts';

const props = defineProps<{
  firmware: Firmware | null;
  /** False means the revision has no versions at all, which needs a different
   *  empty state from "none selected". */
  hasFirmwares: boolean;
  revisionLabel: string;
  canEdit: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'edit', firmware: Firmware): void;
  (e: 'delete', firmware: Firmware): void;
  (e: 'set-production', firmware: Firmware): void;
}>();

const { t } = useI18n();

const isProduction = computed(() => props.firmware?.status === 'production');
</script>
