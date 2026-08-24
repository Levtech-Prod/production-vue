<template>
  <BaseModal v-model="open" :title="title" size="md">
    <form id="document-revision-form" novalidate class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('version_name') }} <span class="text-red-500">*</span>
        </label>
        <input v-model="form.name" class="input" :placeholder="t('version_name_placeholder')" required />
        <p v-if="fieldErrors.name" class="text-xs text-red-500">{{ fieldErrors.name }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('status') }}
        </label>
        <select v-model="form.status" class="input">
          <option v-for="status in DOCUMENT_REVISION_STATUSES" :key="status" :value="status">
            {{ t(`version_status.${status}`) }}
          </option>
        </select>
        <p v-if="form.status === 'production'" class="text-xs text-slate-500">
          {{ t('version_production_takeover_hint') }}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('version_release_notes') }}
        </label>
        <textarea v-model="form.releaseNotes" rows="4" class="input" />
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="submit" form="document-revision-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../../../../components/modal/BaseModal.vue';
import { useRequiredFieldValidation } from '../../../../../composables/useRequiredFieldValidation.ts';
import { DOCUMENT_REVISION_STATUSES } from '../../../../../types/documentRevisions.ts';
import type {
  DocumentRevision,
  DocumentRevisionPayload,
  DocumentRevisionStatus,
} from '../../../../../types/documentRevisions.ts';

const props = defineProps<{
  /** null = creating a new version. */
  revision: DocumentRevision | null;
  saving: boolean;
}>();

const emit = defineEmits<{ saved: [payload: DocumentRevisionPayload] }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const title = computed(() =>
  props.revision ? `${t('edit_version')} — ${props.revision.name}` : t('add_version'),
);

const form = reactive<{ name: string; status: DocumentRevisionStatus; releaseNotes: string }>({
  name: '',
  status: 'testing',
  releaseNotes: '',
});

const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'name', label: t('version_name'), missing: !form.name.trim() },
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.name = props.revision?.name ?? '';
  form.status = props.revision?.status ?? 'testing';
  form.releaseNotes = props.revision?.releaseNotes ?? '';
  resetValidation();
});

function submit() {
  if (!validate()) return;
  emit('saved', {
    name: form.name.trim(),
    status: form.status,
    releaseNotes: form.releaseNotes.trim() || null,
  });
}
</script>
