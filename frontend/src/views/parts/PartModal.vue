<template>
  <BaseModal
    v-model="isOpen"
    :title="part ? `${t('edit')} ${form.name || '…'}` : `${t('add_part')}`"
    size="lg"
  >
    <!-- Form body -->
    <form class="space-y-5" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('category') }}
          </label>
          <select v-model.number="form.categoryId" class="input" required>
            <option :value="0" disabled>{{ t('select_category') }}</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('code') }}
          </label>
          <input
            v-model="form.code"
            class="input"
            :placeholder="t('code')"
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {{ t('name') }}
          </label>
          <input
            v-model="form.name"
            class="input"
            :placeholder="t('name')"
            required
          />
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
      </div>

      <div
        v-if="saveError"
        class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ saveError }}
      </div>

      <PartParameterValueList
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
import PartParameterValueList from './PartParameterValueList.vue';
import type { PartCategory } from '../../types/partCategories.ts';
import type { Part, CreatePartPayload } from '../../types/parts.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  part?: Part | null; // null = add mode, Part = edit mode
  categories: PartCategory[];
  saveError?: string | null;
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
});

const parameterValues = ref<Record<number, string>>({});

const selectedCategory = computed(() =>
  props.categories.find((c) => c.id === form.categoryId),
);

// Populate form when the modal opens or the part prop changes
watch(
  () => [props.modelValue, props.part] as const,
  ([open, part]) => {
    if (!open) return;
    if (part) {
      form.categoryId = part.categoryId;
      form.name = part.name;
      form.code = part.code;
      form.pricePerPiece = Number(part.pricePerPiece) || 0;
      form.location = part.location ?? '';
      form.description = part.description ?? '';
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

  emit('saved', {
    categoryId: form.categoryId,
    name: form.name,
    code: form.code,
    pricePerPiece: Number(form.pricePerPiece) || 0,
    location: form.location || null,
    description: form.description || null,
    parameters,
  });
}
</script>
