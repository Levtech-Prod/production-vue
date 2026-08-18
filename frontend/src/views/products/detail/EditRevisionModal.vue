<template>
  <BaseModal
    v-model="open"
    :title="`${t('edit_revision')} — ${revision?.label ?? ''}`"
    size="md"
  >
    <form
      id="edit-revision-form"
      novalidate
      class="flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          {{ t('label') }} <span class="text-red-500">*</span>
        </label>
        <input v-model="form.label" class="input" required />
        <p v-if="fieldErrors.label" class="text-xs text-red-500">
          {{ fieldErrors.label }}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          {{ t('status') }}
        </label>
        <select v-model="form.status" class="input">
          <option value="draft">{{ t('revision_status.draft') }}</option>
          <option value="active">{{ t('revision_status.active') }}</option>
          <option value="deprecated">
            {{ t('revision_status.deprecated') }}
          </option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          {{ t('change_notes') }}
        </label>
        <textarea v-model="form.changeNotes" rows="3" class="input" />
      </div>

      <p v-if="compositionHint" class="text-xs text-slate-400">
        {{ t('composition_edited_in_tree') }}
      </p>
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button
        type="submit"
        form="edit-revision-form"
        class="btn-primary"
        :disabled="saving"
      >
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>

  <ConfirmModal
    :visible="confirmOpen"
    :title="t('confirm_revision_changes')"
    :message="confirmMessage"
    :confirm-text="t('save')"
    :cancel-text="t('cancel')"
    :loading="saving"
    variant="primary"
    @confirm="confirmSave"
    @cancel="confirmOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../../components/modal/BaseModal.vue';
import ConfirmModal from '../../../components/notification/ConfirmModal.vue';
import { useRequiredFieldValidation } from '../../../composables/useRequiredFieldValidation.ts';
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
  /** Product revisions only: points at the tree, which is where their linked
   *  sub-product revisions are edited. */
  compositionHint?: boolean;
}>();

const emit = defineEmits<{ saved: [payload: EditRevisionPayload] }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const form = reactive<{
  label: string;
  status: RevisionStatus;
  changeNotes: string;
}>({
  label: '',
  status: 'draft',
  changeNotes: '',
});
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(
  () => [{ key: 'label', label: t('label'), missing: !form.label.trim() }],
);

const confirmOpen = ref(false);

watch(open, (isOpen) => {
  confirmOpen.value = false;
  if (!isOpen || !props.revision) return;
  form.label = props.revision.label;
  form.status = props.revision.status;
  form.changeNotes = props.revision.changeNotes ?? '';
  resetValidation();
});

const pendingChanges = computed<string[]>(() => {
  const lines: string[] = [];
  const rev = props.revision;
  if (!rev) return lines;

  if (form.label.trim() !== rev.label) {
    lines.push(
      t('change_line_changed', {
        name: t('label'),
        from: rev.label,
        to: form.label.trim(),
      }),
    );
  }
  if (form.status !== rev.status) {
    lines.push(
      t('change_line_changed', {
        name: t('status'),
        from: t(`revision_status.${rev.status}`),
        to: t(`revision_status.${form.status}`),
      }),
    );
  }
  if ((form.changeNotes.trim() || null) !== (rev.changeNotes?.trim() || null)) {
    lines.push(t('change_line_updated', { name: t('change_notes') }));
  }

  return lines;
});

const confirmMessage = computed(
  () =>
    `${t('confirmations.save_revision_changes_msg')}\n\n${pendingChanges.value.join('\n')}`,
);

function submit() {
  if (!validate()) return;
  // Nothing to confirm and nothing to save.
  if (pendingChanges.value.length === 0) {
    open.value = false;
    return;
  }
  confirmOpen.value = true;
}

function confirmSave() {
  emit('saved', {
    label: form.label.trim(),
    status: form.status,
    changeNotes: form.changeNotes.trim() || null,
  });
}
</script>
