<template>
  <BaseModal v-model="open" :title="t('save_as_new_revision')" size="md">
    <form id="compose-revision-form" novalidate class="flex flex-col gap-4" @submit.prevent="submit">
      <p class="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
        {{ t('compose_summary', { count: selectedCount }) }}
      </p>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('label') }} <span class="text-red-500">*</span>
        </label>
        <input v-model="form.label" class="input" required :placeholder="t('revision_label_placeholder')" />
        <p v-if="fieldErrors.label" class="text-xs text-red-500">{{ fieldErrors.label }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('change_notes') }}
        </label>
        <textarea v-model="form.changeNotes" rows="3" class="input" />
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="submit" form="compose-revision-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../../components/modal/BaseModal.vue';
import { useRequiredFieldValidation } from '../../../composables/useRequiredFieldValidation.ts';
import type { ProductRevision } from '../../../types/products.ts';

const props = defineProps<{
  revisions: ProductRevision[];
  selectedCount: number;
  saving?: boolean;
}>();

const emit = defineEmits<{ saved: [payload: { label: string; changeNotes: string | null }] }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const form = reactive({ label: '', changeNotes: '' });
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'label', label: t('label'), missing: !form.label.trim() },
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.label = `Rev. ${props.revisions.length + 1}`;
  form.changeNotes = '';
  resetValidation();
});

function submit() {
  if (!validate()) return;

  emit('saved', {
    label: form.label.trim(),
    changeNotes: form.changeNotes.trim() || null,
  });
}
</script>
