<template>
  <li class="relative">
    <!-- Rail: dot plus the line down to the next entry. The line is hidden on
         the last item so the timeline ends cleanly. -->
    <span
      v-if="!isLast"
      class="absolute left-[13px] top-5 bottom-0 w-px bg-slate-200"
      aria-hidden="true"
    />

    <button
      type="button"
      class="relative flex w-full items-start gap-2 rounded-r-md border-l-2 py-2 pl-2 pr-2 text-left transition-colors"
      :class="
        isActive
          ? 'border-blue-500 bg-blue-50'
          : 'border-transparent hover:bg-slate-50'
      "
      :aria-current="isActive ? 'true' : undefined"
      @click="emit('select')"
    >
      <span
        class="mt-1 h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
        :class="statusDot(revision.status)"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5">
          <span
            class="truncate text-sm font-semibold"
            :class="isActive ? 'text-blue-700' : 'text-slate-800'"
          >
            {{ revision.label }}
          </span>
          <Star
            v-if="isDefault"
            class="h-3 w-3 shrink-0 fill-amber-400 text-amber-400"
            :title="t('default_revision')"
          />
          <span
            class="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            :class="statusBadgeClass(revision.status)"
          >
            {{ t(`revision_status.${revision.status}`) }}
          </span>
        </span>

        <span class="mt-0.5 block truncate text-[11px] text-slate-400">
          {{ formatDate(revision.createdAt) }} ·
          {{ revision.createdByName || '—' }}
        </span>
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { Star } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatDate } from '../../../../utils/formatters.ts';
import { statusBadgeClass, statusDot } from '../revisionHelpers.ts';
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
