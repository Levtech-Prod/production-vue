<template>
  <div
    v-if="revision"
    class="grid items-start gap-x-2 rounded-md px-1.5 py-1"
    :style="{ gridTemplateColumns: PRODUCT_SIDE_GRID }"
    :class="sideAccentClass(same)"
  >
    <div
      class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-300"
    >
      <img v-if="image" :src="image" class="h-full w-full object-cover" :alt="name" />
      <template v-else>▣</template>
    </div>
    <div class="min-w-0 break-words">
      <div class="font-semibold text-slate-800">{{ name }}</div>
      <div class="font-mono text-xs text-slate-400">{{ sku }}</div>
    </div>
    <div class="min-w-0 break-words">
      <div class="text-center text-xs text-slate-600">{{ revision.label }}</div>
      <button
        v-if="showDrill"
        type="button"
        class="mt-0.5 inline-flex items-center gap-0.5 text-xs text-slate-400 hover:text-blue-600"
        @click="$emit('drill')"
      >
        {{ t('compare_parts') }}
        <ChevronRight class="h-3 w-3" />
      </button>
    </div>
  </div>
  <div
    v-else
    class="grid min-h-[2.75rem] place-items-center rounded-md border border-dashed border-slate-200 text-xs text-slate-300"
  >
    {{ t('not_in_this_revision') }}
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ChevronRight } from 'lucide-vue-next';
import type { SubProductRevision } from '../../../types/products.ts';
import { PRODUCT_SIDE_GRID, sideAccentClass } from './compareHelpers.ts';

defineProps<{
  revision: SubProductRevision | null;
  name: string;
  sku: string;
  image: string | null;
  same: boolean | null;
  showDrill?: boolean;
}>();
defineEmits<{ drill: [] }>();

const { t } = useI18n();
</script>
