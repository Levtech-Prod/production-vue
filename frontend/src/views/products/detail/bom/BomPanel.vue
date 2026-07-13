<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 border-b border-slate-100 px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="min-w-0 truncate font-semibold text-slate-700">{{ t('bom_title') }}</h3>
        <span
          v-if="headerChip"
          class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
        >
          {{ headerChip }}
        </span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="loading" class="py-8 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </div>

      <!-- Flat parts list for a single sub-product revision -->
      <template v-else-if="mode === 'subRev'">
        <div v-if="parts.length === 0" class="py-8 text-center text-sm text-slate-400">
          {{ t('no_parts_in_revision') }}
        </div>
        <template v-else>
          <div
            class="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500"
          >
            <span>{{ t('part') }}</span>
            <span>{{ t('quantity') }}</span>
          </div>
          <ul class="flex flex-col divide-y divide-slate-100">
            <li
              v-for="part in parts"
              :key="part.id"
              class="flex items-center justify-between gap-3 px-4 py-2"
            >
              <div class="flex min-w-0 items-center gap-2.5">
                <img
                  v-if="part.image"
                  :src="part.image"
                  class="h-8 w-8 shrink-0 rounded-md border border-slate-200 object-cover"
                  :alt="part.name"
                />
                <div
                  v-else
                  class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-100 text-slate-300"
                >
                  ▣
                </div>
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-slate-800">{{ part.name }}</div>
                  <div class="truncate font-mono text-xs text-slate-400">{{ part.code }}</div>
                </div>
              </div>
              <div class="shrink-0 text-right text-sm">
                <span class="font-semibold">{{ part.quantity }}</span>
                <span class="text-slate-400"> {{ part.unit || '' }}</span>
              </div>
            </li>
          </ul>
        </template>
      </template>

      <!-- Full BOM grouped by sub-product -->
      <template v-else>
        <div v-if="bom.length === 0" class="py-8 text-center text-sm text-slate-400">
          {{ t('no_bom_parts') }}
        </div>
        <template v-else>
          <div
            v-for="sp in bom"
            :key="sp.subProductId"
            class="border-b border-slate-100 last:border-0"
          >
            <div class="flex items-center gap-2 bg-slate-50 px-4 py-2">
              <span class="flex-1 truncate text-xs font-semibold text-slate-600">
                {{ sp.subProductName }}
              </span>
              <span
                class="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500"
              >
                {{ sp.subProductRevisionLabel }}
              </span>
            </div>
            <div v-if="sp.parts.length === 0" class="px-4 py-2 text-xs text-slate-400">
              {{ t('no_bom_parts') }}
            </div>
            <ul v-else class="divide-y divide-slate-50">
              <li
                v-for="part in sp.parts"
                :key="part.id"
                class="flex items-center justify-between gap-3 px-4 py-2"
              >
                <div class="flex min-w-0 items-center gap-2.5">
                  <img
                    v-if="part.image"
                    :src="part.image"
                    class="h-7 w-7 shrink-0 rounded-md border border-slate-200 object-cover"
                    :alt="part.name"
                  />
                  <div
                    v-else
                    class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] text-slate-300"
                  >
                    ▣
                  </div>
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-slate-800">{{ part.name }}</div>
                    <div class="truncate font-mono text-xs text-slate-400">{{ part.code }}</div>
                  </div>
                </div>
                <div class="shrink-0 text-right text-sm">
                  <span class="font-semibold">{{ part.quantity }}</span>
                  <span class="text-slate-400"> {{ part.unit || '' }}</span>
                </div>
              </li>
            </ul>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { BomSubProduct, RevisionPart } from '../../../../types/products.ts';

defineProps<{
  mode: 'product' | 'subRev';
  bom: BomSubProduct[];
  parts: RevisionPart[];
  loading: boolean;
  headerChip?: string;
}>();

const { t } = useI18n();
</script>
