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
          {{ t('copy_documents_from') }}
        </label>
        <select v-model="form.documentsFromId" class="input">
          <option :value="null">{{ t('copy_documents_from_none') }}</option>
          <option v-for="rev in sortedRevisions" :key="rev.id" :value="rev.id">
            {{ rev.label }}
          </option>
        </select>
        <p class="text-xs text-slate-400">{{ t('copy_documents_from_hint') }}</p>
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
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../../components/modal/BaseModal.vue';
import { useRequiredFieldValidation } from '../../../composables/useRequiredFieldValidation.ts';
import type { ProductRevision } from '../../../types/products.ts';

const props = defineProps<{
  revisions: ProductRevision[];
  selectedCount: number;
  saving?: boolean;
}>();

const emit = defineEmits<{
  saved: [
    payload: { label: string; changeNotes: string | null; documentsFromId: number | null },
  ];
}>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

// Newest first — the likeliest source.
const sortedRevisions = computed(() =>
  [...props.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber),
);

const form = reactive<{
  label: string;
  changeNotes: string;
  documentsFromId: number | null;
}>({ label: '', changeNotes: '', documentsFromId: null });
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'label', label: t('label'), missing: !form.label.trim() },
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.label = `Rev. ${props.revisions.length + 1}`;
  form.changeNotes = '';
  // Default to newest: what the backend did implicitly, now visible.
  form.documentsFromId = sortedRevisions.value[0]?.id ?? null;
  resetValidation();
});

function submit() {
  if (!validate()) return;

  emit('saved', {
    label: form.label.trim(),
    changeNotes: form.changeNotes.trim() || null,
    documentsFromId: form.documentsFromId,
  });
}
</script>
