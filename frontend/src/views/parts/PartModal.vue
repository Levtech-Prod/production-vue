<template>
  <BaseModal
    v-model="isOpen"
    :title="part ? `${t('edit')} ${form.name || '…'}` : `${t('add_part')}`"
    size="lg"
  >
    <!-- Form body -->
    <form novalidate class="space-y-5" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('category') }} <span class="text-red-500">*</span>
          </label>
          <select v-model.number="form.categoryId" class="input" required>
            <option :value="0" disabled>{{ t('select_category') }}</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
          <p v-if="fieldErrors.categoryId" class="text-xs text-red-500">{{ fieldErrors.categoryId }}</p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('code') }} <span class="text-red-500">*</span>
          </label>
          <input
            v-model="form.code"
            class="input"
            :placeholder="t('code')"
            required
          />
          <p v-if="fieldErrors.code" class="text-xs text-red-500">{{ fieldErrors.code }}</p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('name') }} <span class="text-red-500">*</span>
          </label>
          <input
            v-model="form.name"
            class="input"
            :placeholder="t('name')"
            required
          />
          <p v-if="fieldErrors.name" class="text-xs text-red-500">{{ fieldErrors.name }}</p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('price_per_piece') }}
          </label>
          <input
            v-model.number="form.pricePerPiece"
            type="number"
            step="0.01"
            min="0"
            class="input"
            :placeholder="t('price_per_piece')"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('location') }}
          </label>
          <input
            v-model="form.location"
            class="input"
            :placeholder="t('location')"
          />
        </div>

        <div class="flex flex-col gap-1 md:col-span-2">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('description') }}
          </label>
          <textarea
            v-model="form.description"
            class="input"
            :placeholder="t('description')"
          ></textarea>
        </div>

        <div class="md:col-span-2">
          <ImageUploadField
            v-model="form.image"
            :label="t('part_image')"
            target="parts"
            :preview-alt="t('part_image_preview')"
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
        <ul
          v-if="saveErrors?.length"
          class="list-disc space-y-0.5 pl-5"
        >
          <li v-for="(msg, i) in saveErrors" :key="i">{{ msg }}</li>
        </ul>
      </div>

      <PartParameterValueList
        ref="parameterListRef"
        v-model="parameterValues"
        :parameters="selectedCategory?.parameters || []"
      />
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
        {{ saving ? t('saving') : part ? t('save') : t('add_part') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import BaseModal from '../../components/modal/BaseModal.vue';
import ImageUploadField from '../../components/uploader/ImageUploadField.vue';
import PartParameterValueList from './PartParameterValueList.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import type { PartCategory } from '../../types/partCategories.ts';
import type { Part, CreatePartPayload } from '../../types/parts.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  part?: Part | null; // null = add mode, Part = edit mode
  categories: PartCategory[];
  saveError?: string | null;
  saveErrors?: string[];
  saving?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [payload: CreatePartPayload];
  clearError: [];
}>();

// Two-way binding for the open state — pass through to BaseModal
const isOpen = defineModel<boolean>({ required: true });

const form = reactive({
  categoryId: 0,
  name: '',
  code: '',
  pricePerPiece: 0,
  location: '',
  description: '',
  image: '',
});

const parameterValues = ref<Record<number, string>>({});
const parameterListRef = ref<InstanceType<typeof PartParameterValueList> | null>(null);
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'categoryId', label: t('category'), missing: !form.categoryId },
  { key: 'code', label: t('code'), missing: !form.code.trim() },
  { key: 'name', label: t('name'), missing: !form.name.trim() },
]);

const selectedCategory = computed(() =>
  props.categories.find((c) => c.id === form.categoryId),
);

// Populate form when the modal opens or the part prop changes
watch(
  () => [props.modelValue, props.part] as const,
  ([open, part]) => {
    if (!open) return;
    resetValidation();
    parameterListRef.value?.resetValidation();
    if (part) {
      form.categoryId = part.categoryId;
      form.name = part.name;
      form.code = part.code;
      form.pricePerPiece = Number(part.pricePerPiece) || 0;
      form.location = part.location ?? '';
      form.description = part.description ?? '';
      form.image = part.image ?? '';
      const values: Record<number, string> = {};
      part.parameters?.forEach((p) => {
        values[p.parameterId] = p.value;
      });
      parameterValues.value = values;
    } else {
      resetForm();
    }
  },
  { immediate: true },
);

// When the category changes, drop values that no longer belong to it
watch(
  () => form.categoryId,
  () => {
    if (!props.part || props.part.categoryId !== form.categoryId) {
      const validIds = new Set(
        (selectedCategory.value?.parameters || []).map((p) => p.id),
      );
      const next: Record<number, string> = {};
      Object.entries(parameterValues.value).forEach(([id, value]) => {
        if (validIds.has(Number(id))) next[Number(id)] = value;
      });
      parameterValues.value = next;
    }
  },
);

function resetForm() {
  form.categoryId = 0;
  form.name = '';
  form.code = '';
  form.pricePerPiece = 0;
  form.location = '';
  form.description = '';
  form.image = '';
  parameterValues.value = {};
}

function save() {
  emit('clearError');

  const parameters = Object.entries(parameterValues.value)
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .map(([parameterId, value]) => ({
      parameterId: Number(parameterId),
      value: String(value),
    }));

  const parametersValid = parameterListRef.value?.validate() ?? true;
  if (!validate() || !parametersValid) return;

  emit('saved', {
    categoryId: form.categoryId,
    name: form.name,
    code: form.code,
    pricePerPiece: Number(form.pricePerPiece) || 0,
    location: form.location || null,
    description: form.description || null,
    image: form.image || null,
    parameters,
  });
}
</script>
