<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      @click="open = !open"
    >
      <SlidersHorizontal class="h-4 w-4" />
      {{ t('columns') }}
    </button>

    <div
      v-if="open"
      class="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
    >
      <p
        class="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
      >
        {{ t('show_as_column') }}
      </p>

      <p v-if="parameters.length === 0" class="px-2 py-2 text-sm text-slate-400">
        {{ t('no_parameters_msg') }}
      </p>

      <label
        v-for="p in parameters"
        :key="p.id"
        class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        <input
          type="checkbox"
          class="rounded"
          :checked="p.showAsColumn ?? false"
          @change="onToggle(p)"
        />
        <span class="truncate">{{ p.name }}</span>
        <span v-if="p.unit" class="text-slate-400">({{ p.unit }})</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { SlidersHorizontal } from 'lucide-vue-next';
import type { PartCategoryParameter } from '../../types/partCategories.ts';

defineProps<{
  parameters: PartCategoryParameter[];
}>();

const emit = defineEmits<{
  (e: 'toggle', parameterId: number, showAsColumn: boolean): void;
}>();

const { t } = useI18n();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onToggle(parameter: PartCategoryParameter) {
  if (parameter.id == null) return;
  emit('toggle', parameter.id, !(parameter.showAsColumn ?? false));
}

// Close the popover when clicking outside of it.
function onDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>
