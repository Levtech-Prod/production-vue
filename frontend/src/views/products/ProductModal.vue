<template>
  <BaseModal
    v-model="open"
    :title="product ? t('edit_product') : t('add_product')"
    size="lg"
  >
    <form id="product-form" class="flex flex-col gap-4" @submit.prevent="submit">
      <div v-if="saveError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ saveError }}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('name') }}
          </label>
          <input v-model="form.name" class="input" required />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            SKU
          </label>
          <input v-model="form.sku" class="input" required />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('type') }}
        </label>
        <input v-model="form.type" class="input" />
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
        target="products"
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

const open = defineModel<boolean>({ default: false });

const form = reactive<ProductPayload>({
  name: '',
  sku: '',
  type: '',
  description: '',
  image: '',
});

// Reset the form whenever the modal opens (populate for edit, blank for new).
watch(open, (isOpen) => {
  if (!isOpen) return;
  form.name = props.product?.name ?? '';
  form.sku = props.product?.sku ?? '';
  form.type = props.product?.type ?? '';
  form.description = props.product?.description ?? '';
  form.image = props.product?.image ?? '';
});

function submit() {
  emit('saved', {
    name: form.name.trim(),
    sku: form.sku.trim(),
    type: form.type?.trim() || null,
    description: form.description?.trim() || null,
    image: form.image || null,
  });
}
</script>
