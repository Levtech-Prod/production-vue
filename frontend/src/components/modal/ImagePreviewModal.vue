<template>
  <BaseModal v-model="isOpen" :title="modalTitle" size="xl" :layer="layer">
    <img
      v-if="image"
      :src="image"
      :alt="alt || modalTitle"
      class="mx-auto max-h-[70vh] w-auto rounded-lg object-contain"
    />
  </BaseModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from './BaseModal.vue';
import type { ModalLayer } from '../../utils/overlayLayers.ts';

const props = withDefaults(
  defineProps<{
    // Image URL to display full-size. Nothing renders in the body if empty.
    image?: string | null;
    // Modal header title, e.g. the part/category name. Falls back to t('image').
    title?: string | null;
    // Alt text for the image. Falls back to `title`.
    alt?: string | null;
    // 'nested' when the table raising this preview is itself inside a dialog.
    layer?: ModalLayer;
  }>(),
  { layer: 'modal' },
);

const { t } = useI18n();

// Two-way binding for the open state — pass through to BaseModal.
const isOpen = defineModel<boolean>({ required: true });

const modalTitle = computed(() => props.title || t('image'));
</script>
