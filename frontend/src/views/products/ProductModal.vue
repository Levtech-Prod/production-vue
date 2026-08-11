<template>
  <BaseModal
    v-model="open"
    :title="product ? t('edit_product') : t('add_product')"
    size="lg"
  >
    <form id="product-form" novalidate class="flex flex-col gap-4" @submit.prevent="submit">
      <div v-if="saveError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ saveError }}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('name') }} <span class="text-red-500">*</span>
          </label>
          <input v-model="form.name" class="input" required />
          <p v-if="fieldErrors.name" class="text-xs text-red-500">{{ fieldErrors.name }}</p>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            SKU <span class="text-red-500">*</span>
          </label>
          <input v-model="form.sku" class="input" required />
          <p v-if="fieldErrors.sku" class="text-xs text-red-500">{{ fieldErrors.sku }}</p>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('type') }} <span class="text-red-500">*</span>
        </label>
        <select v-model="form.type" class="input" required>
          <option value="" disabled>{{ t('select_type') }}</option>
          <option v-for="pt in productTypesStore.productTypes" :key="pt.id" :value="pt.name">
            {{ pt.name }}
          </option>
        </select>
        <p v-if="fieldErrors.type" class="text-xs text-red-500">{{ fieldErrors.type }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('description') }}
        </label>
        <textarea v-model="form.description" rows="3" class="input" />
      </div>

      <ImageUploadField
        v-model="form.image"
        :label="t('image')"
        target="temp"
        :preview-alt="form.name"
      />
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button
        type="submit"
        form="product-form"
        class="btn-primary"
        :disabled="saving"
      >
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import ImageUploadField from '../../components/uploader/ImageUploadField.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import { useProductTypesStore } from '../../stores/productTypesStore.ts';
import type { ProductSummary, ProductPayload } from '../../types/products.ts';

const props = defineProps<{
  product?: ProductSummary | null;
  saveError?: string | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  saved: [payload: ProductPayload];
}>();

const { t } = useI18n();
const productTypesStore = useProductTypesStore();

const open = defineModel<boolean>({ default: false });

const form = reactive<ProductPayload>({
  name: '',
  sku: '',
  type: '',
  description: '',
  image: '',
});
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'name', label: t('name'), missing: !form.name.trim() },
  { key: 'sku', label: t('sku'), missing: !form.sku.trim() },
  { key: 'type', label: t('type'), missing: !form.type.trim() },
]);

// Reset the form whenever the modal opens (populate for edit, blank for new).
watch(open, (isOpen) => {
  if (!isOpen) return;
  productTypesStore.loadProductTypes();
  form.name = props.product?.name ?? '';
  form.sku = props.product?.sku ?? '';
  form.type = props.product?.type ?? '';
  form.description = props.product?.description ?? '';
  form.image = props.product?.image ?? '';
  resetValidation();
});

function submit() {
  if (!validate()) return;

  emit('saved', {
    name: form.name.trim(),
    sku: form.sku.trim(),
    type: form.type.trim(),
    description: form.description?.trim() || null,
    image: form.image,
  });
}
</script>
