<template>
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm">
      <thead class="bg-slate-50 text-xs uppercase text-slate-500">
        <tr>
          <th class="p-4">{{ t('image') }}</th>
          <th class="p-4">{{ t('code') }}</th>
          <th class="p-4">{{ t('name') }}</th>
          <th class="p-4">{{ t('category') }}</th>
          <th class="p-4">{{ t('price_per_piece') }}</th>
          <th class="p-4">{{ t('location') }}</th>
          <th class="p-4">{{ t('parameters') }}</th>
          <th class="p-4">{{ t('quantity') }}</th>
          <th v-if="hasActions" class="p-4">{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="parts.length === 0">
          <td
            :colspan="hasActions ? 8 : 7"
            class="py-12 text-center text-sm text-slate-400"
          >
            {{ emptyText || t('no_parts_msg') }}
          </td>
        </tr>
        <tr
          v-for="part in parts"
          :key="part.id"
          class="border-t border-slate-100 transition-colors hover:bg-slate-50"
        >
          <td class="p-4">
            <button
              v-if="part.image"
              type="button"
              class="block"
              :title="t('view_image')"
              @click="openImagePreview(part)"
            >
              <img
                :src="part.image"
                class="h-12 w-12 rounded-lg border border-slate-200 object-cover transition-transform hover:scale-105"
                :alt="part.name"
              />
            </button>
            <div
              v-else
              class="grid h-12 w-12 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
            >
              ▣
            </div>
          </td>
          <td class="p-4 font-mono text-xs text-slate-600">
            {{ part.code }}
          </td>
          <td class="p-4 font-semibold">{{ part.name }}</td>
          <td class="p-4 text-slate-500">{{ part.category.name }}</td>
          <td class="p-4">{{ part.pricePerPiece }}</td>
          <td class="p-4 text-slate-500">{{ part.location || '—' }}</td>
          <td class="p-4">
            <div class="flex flex-col gap-1">
              <span
                v-for="v in part.parameters"
                :key="v.id"
                class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {{ v.parameter?.name }}: {{ v.value }}
              </span>
              <span v-if="!part.parameters?.length" class="text-slate-300"
                >—</span
              >
            </div>
          </td>
          <td v-if="hasActions" class="p-4">
            <slot name="qty" :part="part" />
          </td>
          <td v-if="hasActions" class="p-4">
            <slot name="actions" :part="part" />
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Image lightbox -->
    <ImagePreviewModal
      v-model="imagePreviewOpen"
      :image="previewPart?.image"
      :title="previewPart?.name"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useSlots } from 'vue';
import { useI18n } from 'vue-i18n';
import ImagePreviewModal from '../../components/modal/ImagePreviewModal.vue';
import type { Part } from '../../types/parts.ts';

defineProps<{
  parts: Part[];
  emptyText?: string;
}>();

const { t } = useI18n();
const slots = useSlots();

// The actions column only renders when the consumer provides content for it.
const hasActions = computed(() => !!slots.actions);

const imagePreviewOpen = ref(false);
const previewPart = ref<Part | null>(null);

function openImagePreview(part: Part) {
  previewPart.value = part;
  imagePreviewOpen.value = true;
}
</script>
