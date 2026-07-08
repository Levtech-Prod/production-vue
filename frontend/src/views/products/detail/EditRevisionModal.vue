<template>
  <BaseModal v-model="open" :title="`${t('edit_revision')} — ${revision?.label ?? ''}`" size="md">
    <form id="edit-revision-form" class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('label') }}
        </label>
        <input v-model="form.label" class="input" required />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('status') }}
        </label>
        <select v-model="form.status" class="input">
          <option value="draft">{{ t('revision_status.draft') }}</option>
          <option value="active">{{ t('revision_status.active') }}</option>
          <option value="deprecated">{{ t('revision_status.deprecated') }}</option>
        </select>
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
      <button type="submit" form="edit-revision-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../../components/modal/BaseModal.vue';
import type { RevisionStatus } from '../../../types/products.ts';
import type { EditRevisionPayload } from './types.ts';

interface EditableRevision {
  label: string;
  status: RevisionStatus;
  changeNotes?: string | null;
}

const props = defineProps<{
  revision: EditableRevision | null;
  saving?: boolean;
}>();

const emit = defineEmits<{ saved: [payload: EditRevisionPayload] }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const form = reactive<EditRevisionPayload>({
  label: '',
  status: 'draft',
  changeNotes: '',
});

watch(open, (isOpen) => {
  if (!isOpen || !props.revision) return;
  form.label = props.revision.label;
  form.status = props.revision.status;
  form.changeNotes = props.revision.changeNotes ?? '';
});

function submit() {
  emit('saved', {
    label: form.label.trim(),
    status: form.status,
    changeNotes: form.changeNotes?.trim() || null,
  });
}
</script>
