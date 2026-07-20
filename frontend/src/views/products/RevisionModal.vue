<template>
  <BaseModal v-model="open" :title="t('new_revision')" size="md">
    <form id="revision-form" novalidate class="flex flex-col gap-4" @submit.prevent="submit">
      <div v-if="saveError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ saveError }}
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('label') }} <span class="text-red-500">*</span>
        </label>
        <input v-model="form.label" class="input" required :placeholder="t('revision_label_placeholder')" />
        <p v-if="fieldErrors.label" class="text-xs text-red-500">{{ fieldErrors.label }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('duplicate_from') }}
        </label>
        <select v-model="form.duplicateFromId" class="input">
          <option :value="null">{{ t('start_empty') }}</option>
          <option v-for="rev in revisions" :key="rev.id" :value="rev.id">
            {{ rev.label }}
          </option>
        </select>
        <p class="text-xs text-slate-400">{{ t('duplicate_from_hint') }}</p>
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
      <button type="submit" form="revision-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import type { ProductRevision, NewRevisionPayload } from '../../types/products.ts';

const props = defineProps<{
  revisions: ProductRevision[];
  saveError?: string | null;
  saving?: boolean;
}>();

const emit = defineEmits<{ saved: [payload: NewRevisionPayload] }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const form = reactive<NewRevisionPayload>({
  label: '',
  changeNotes: '',
  duplicateFromId: null,
});
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'label', label: t('label'), missing: !form.label.trim() },
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  const next = props.revisions.length + 1;
  form.label = `Rev. ${next}`;
  form.changeNotes = '';
  // Default to duplicating the latest revision, if any.
  form.duplicateFromId = props.revisions.length
    ? props.revisions[props.revisions.length - 1].id
    : null;
  resetValidation();
});

function submit() {
  if (!validate()) return;

  emit('saved', {
    label: form.label.trim(),
    changeNotes: form.changeNotes?.trim() || null,
    duplicateFromId: form.duplicateFromId || null,
  });
}
</script>
