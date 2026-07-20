<template>
  <BaseModal v-model="open" :title="title" size="sm">
    <form
      id="type-form"
      novalidate
      class="flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <div
        v-if="saveError"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
      >
        {{ saveError }}
      </div>

      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          {{ t('name') }} <span class="text-red-500">*</span>
        </label>
        <input v-model="name" class="input" required />
        <p v-if="fieldErrors.name" class="text-xs text-red-500">
          {{ fieldErrors.name }}
        </p>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button
        type="submit"
        form="type-form"
        class="btn-primary"
        :disabled="saving"
      >
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';

const props = defineProps<{
  title: string;
  initialName?: string | null;
  saveError?: string | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  saved: [name: string];
}>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const name = ref('');
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'name', label: t('name'), missing: !name.value.trim() },
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = props.initialName ?? '';
  resetValidation();
});

function submit() {
  if (!validate()) return;
  emit('saved', name.value.trim());
}
</script>
