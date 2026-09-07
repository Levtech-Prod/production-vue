<template>
  <BaseModal
    v-model="open"
    :title="project ? t('edit_project') : t('add_project')"
    size="xl"
  >
    <form id="project-form" novalidate class="flex flex-col gap-4" @submit.prevent="submit">
      <div v-if="saveError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ saveError }}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="flex flex-col gap-1 sm:col-span-2">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('name') }} <span class="text-red-500">*</span>
          </label>
          <input v-model="form.name" class="input" required />
          <p v-if="fieldErrors.name" class="text-xs text-red-500">{{ fieldErrors.name }}</p>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('deadline') }}
          </label>
          <input v-model="form.deadline" type="date" class="input" />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('description') }}
        </label>
        <textarea v-model="form.description" rows="3" class="input" />
      </div>

      <ProjectProductsEditor ref="productsEditorRef" v-model="products" />
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="submit" form="project-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import ProjectProductsEditor from './ProjectProductsEditor.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import type { Project, ProjectPayload, ProjectProductInput } from '../../types/projects.ts';

const props = defineProps<{
  /** The project being edited, already loaded with its products. */
  project?: Project | null;
  saveError?: string | null;
  saving?: boolean;
}>();

const emit = defineEmits<{ saved: [payload: ProjectPayload] }>();

const { t } = useI18n();

const open = defineModel<boolean>({ default: false });

const form = reactive({ name: '', description: '', deadline: '' });
const products = ref<ProjectProductInput[]>([]);
const productsEditorRef = ref<InstanceType<typeof ProjectProductsEditor> | null>(null);

const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'name', label: t('name'), missing: !form.name.trim() },
]);

// Reset whenever the modal opens (populate for edit, blank for new).
watch(open, (isOpen) => {
  if (!isOpen) return;
  form.name = props.project?.name ?? '';
  form.description = props.project?.description ?? '';
  form.deadline = props.project?.deadline ?? '';
  products.value = (props.project?.products ?? []).map((p) => ({
    productId: p.productId,
    productRevisionId: p.productRevisionId,
    quantity: p.quantity,
  }));
  resetValidation();
  productsEditorRef.value?.resetValidation();
});

function submit() {
  // Both run before the guard, so a bad name and a bad quantity are reported
  // together rather than one screenful at a time.
  const productsValid = productsEditorRef.value?.validate() ?? false;
  if (!validate() || !productsValid) return;

  emit('saved', {
    name: form.name.trim(),
    description: form.description.trim() || null,
    deadline: form.deadline || null,
    products: products.value,
  });
}
</script>
