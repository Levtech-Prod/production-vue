<template>
  <ConfirmModal
    :visible="target != null"
    :title="t(titleKey)"
    :message="`${t(messageKey)}${subject ? `: ${subject}` : ''}`"
    :confirm-text="t('delete')"
    :cancel-text="t('cancel')"
    :loading="loading"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  />
</template>

<script setup lang="ts" generic="T">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ConfirmModal from './ConfirmModal.vue';

/**
 * The "are you sure you want to delete X" shape, which every delete
 * confirmation on the product detail page repeats: visible while a target is
 * held, the target's name appended to the body copy, and the same two buttons.
 *
 * Pairs with `useConfirmDelete`, whose `target` / `busy` / `confirm` / `cancel`
 * map straight onto these props and events.
 */
// Generic so `label` is checked against the actual target type at each call
// site rather than degrading to `any`.
const props = defineProps<{
  /** The pending target; `null` closes the dialog. */
  target: T | null;
  /** i18n key for the heading, e.g. 'delete_firmware'. */
  titleKey: string;
  /** i18n key for the body, e.g. 'confirmations.delete_firmware_msg'. */
  messageKey: string;
  /** How to name the target in the body. Omit for a nameless confirmation. */
  label?: (target: T) => string;
  loading?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const { t } = useI18n();

const subject = computed(() =>
  props.target != null && props.label ? props.label(props.target) : '',
);
</script>
