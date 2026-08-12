<template>
  <BaseModal
    v-model="isOpen"
    :title="
      category
        ? `${t('edit')} ${form.name || '…'}`
        : `${t('add_part_category')}`
    "
    size="lg"
  >
    <!-- Form body -->
    <form novalidate class="space-y-5" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium text-slate-500 uppercase tracking-wide"
            >{{ t('name') }} <span class="text-red-500">*</span></label
          >
          <input
            v-model="form.name"
            class="input"
            :placeholder="t('name')"
            required
          />
          <p v-if="fieldErrors.name" class="text-xs text-red-500">{{ fieldErrors.name }}</p>
        </div>
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium text-slate-500 uppercase tracking-wide"
            >{{ t('description') }} <span class="text-red-500">*</span></label
          >
          <input
            v-model="form.description"
            class="input"
            :placeholder="t('description')"
            required
          />
          <p v-if="fieldErrors.description" class="text-xs text-red-500">{{ fieldErrors.description }}</p>
        </div>

        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium text-slate-500 uppercase tracking-wide"
            >{{ t('part_name_mode') }}</label
          >
          <select v-model="form.partNameMode" class="input">
            <option value="custom">{{ t('part_name_mode_custom') }}</option>
            <option value="parameters">
              {{ t('part_name_mode_parameters') }}
            </option>
          </select>
          <p class="text-xs text-slate-400">
            {{
              form.partNameMode === 'parameters'
                ? t('part_name_mode_parameters_hint')
                : t('part_name_mode_custom_hint')
            }}
          </p>
        </div>

        <div class="md:col-span-2">
          <ImageUploadField
            v-model="form.image"
            :label="t('category_image')"
            target="part-categories"
            :preview-alt="t('category_image_preview')"
          />
        </div>
      </div>

      <div
        v-if="saveError || saveErrors?.length"
        class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        <p v-if="saveError" :class="{ 'mb-1 font-medium': saveErrors?.length }">
          {{ saveError }}
        </p>
        <ul v-if="saveErrors?.length" class="list-disc space-y-0.5 pl-5">
          <li v-for="(msg, i) in saveErrors" :key="i">{{ msg }}</li>
        </ul>
      </div>
    </form>

    <!-- Footer slot -->
    <template #footer>
      <button
        type="button"
        class="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
        @click="isOpen = false"
      >
        {{ t('cancel') }}
      </button>
      <button
        type="button"
        class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60"
        :disabled="saving"
        @click="save"
      >
        {{
          saving ? t('saving') : category ? t('save') : t('add_part_category')
        }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import BaseModal from '../../components/modal/BaseModal.vue';
import ImageUploadField from '../../components/uploader/ImageUploadField.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import type {
  PartCategory,
  PartNameMode,
} from '../../types/partCategories.ts';

import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  category?: PartCategory | null; // null = add mode, PartCategory = edit mode
  saveError?: string | null;
  saveErrors?: string[];
  saving?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [
    payload: {
      name: string;
      description: string;
      image: string | null;
      partNameMode: PartNameMode;
    },
  ];
  clearError: [];
}>();

// Two-way binding for the open state — pass through to BaseModal
const isOpen = defineModel<boolean>({ required: true });

const form = reactive({
  name: '',
  description: '',
  image: '',
  partNameMode: 'custom' as PartNameMode,
});
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'name', label: t('name'), missing: !form.name.trim() },
  { key: 'description', label: t('description'), missing: !form.description.trim() },
]);

// Populate form when the modal opens or the category prop changes
watch(
  () => [props.modelValue, props.category] as const,
  ([open, category]) => {
    if (!open) return;
    resetValidation();
    if (category) {
      form.name = category.name;
      form.description = category.description ?? '';
      form.image = category.image ?? '';
      form.partNameMode = category.partNameMode;
    } else {
      resetForm();
    }
  },
  { immediate: true },
);

function resetForm() {
  form.name = '';
  form.description = '';
  form.image = '';
  form.partNameMode = 'custom';
}

function save() {
  emit('clearError');

  if (!validate()) return;

  emit('saved', {
    name: form.name,
    description: form.description,
    image: form.image || null,
    partNameMode: form.partNameMode,
  });
}
</script>
