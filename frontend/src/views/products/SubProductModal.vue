<template>
  <BaseModal
    v-model="open"
    :title="subProduct ? t('edit_sub_product') : t('new_sub_product')"
    size="lg"
  >
    <form
      id="sub-product-form"
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

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            {{ t('name') }} <span class="text-red-500">*</span>
          </label>
          <input v-model="form.name" class="input" required />
          <p v-if="fieldErrors.name" class="text-xs text-red-500">
            {{ fieldErrors.name }}
          </p>
        </div>
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            SKU
          </label>
          <input v-model="form.sku" class="input" />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          {{ t('type') }} <span class="text-red-500">*</span>
        </label>
        <select v-model="form.type" class="input" required>
          <option value="" disabled>{{ t('select_type') }}</option>
          <option
            v-for="spt in productTypesStore.subProductTypes"
            :key="spt.id"
            :value="spt.name"
          >
            {{ spt.name }}
          </option>
        </select>
        <p v-if="fieldErrors.type" class="text-xs text-red-500">
          {{ fieldErrors.type }}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          {{ t('description') }}
        </label>
        <textarea v-model="form.description" rows="3" class="input" />
      </div>

      <ImageUploadField
        v-model="form.image"
        :label="t('image')"
        target="sub-products"
        :preview-alt="form.name"
        required
        :error="fieldErrors.image"
      />

      <PartsPicker v-if="!subProduct" ref="partsPickerRef" v-model="selectedParts" />

      <!-- Optionally link the new sub-product to a product revision
           (creation only — editing only touches the sub-product's own
           general info, not revision membership). -->
      <div
        class="rounded-xl border border-slate-200 p-3"
        v-if="!subProduct && productRevisions.length"
      >
        <label
          class="flex items-center gap-2 text-sm font-medium text-slate-700"
        >
          <input
            v-model="addToProduct"
            type="checkbox"
            class="h-4 w-4 rounded border-slate-300"
          />
          {{ t('add_to_product') }}
        </label>
        <p class="mt-1 text-xs text-slate-400">
          {{ t('add_to_product_hint') }}
        </p>

        <select
          v-if="addToProduct"
          v-model.number="targetRevisionId"
          class="input mt-2"
        >
          <option v-for="rev in productRevisions" :key="rev.id" :value="rev.id">
            {{ rev.label }}
          </option>
        </select>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button
        type="submit"
        form="sub-product-form"
        class="btn-primary"
        :disabled="saving"
      >
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, ref, toRefs, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import ImageUploadField from '../../components/uploader/ImageUploadField.vue';
import PartsPicker from './PartsPicker.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import { useProductTypesStore } from '../../stores/productTypesStore.ts';
import type {
  SubProductPayload,
  SelectedPart,
  ProductRevision,
  DetailSubProduct,
} from '../../types/products.ts';

const props = withDefaults(
  defineProps<{
    saveError?: string | null;
    saving?: boolean;
    // Revisions of the current product, offered as link targets.
    productRevisions?: ProductRevision[];
    // Pre-selected target revision (e.g. the one currently selected on screen).
    defaultRevisionId?: number | null;
    // When set, the modal edits this sub-product's general info instead of
    // creating a new one.
    subProduct?: DetailSubProduct | null;
  }>(),
  { productRevisions: () => [], subProduct: null },
);
const { subProduct } = toRefs(props);

const emit = defineEmits<{
  saved: [payload: SubProductPayload, addToRevisionId: number | null];
}>();

const { t } = useI18n();
const productTypesStore = useProductTypesStore();
const open = defineModel<boolean>({ default: false });

const addToProduct = ref(false);
const targetRevisionId = ref<number | null>(null);

const form = reactive<SubProductPayload>({
  name: '',
  sku: '',
  type: '',
  description: '',
  image: '',
});
const selectedParts = ref<SelectedPart[]>([]);
const partsPickerRef = ref<InstanceType<typeof PartsPicker> | null>(null);
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(
  () => [
    { key: 'name', label: t('name'), missing: !form.name.trim() },
    { key: 'type', label: t('type'), missing: !form.type.trim() },
    { key: 'image', label: t('image'), missing: !form.image },
  ],
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  productTypesStore.loadSubProductTypes();
  if (subProduct.value) {
    // Edit mode: pre-fill from the sub-product being edited.
    form.name = subProduct.value.name;
    form.sku = subProduct.value.sku ?? '';
    form.type = subProduct.value.type;
    form.description = subProduct.value.description ?? '';
    form.image = subProduct.value.image;
  } else {
    form.name = '';
    form.sku = '';
    form.type = '';
    form.description = '';
    form.image = '';
  }
  selectedParts.value = [];
  // Default the link target to the currently selected revision, if any.
  targetRevisionId.value =
    props.defaultRevisionId ?? props.productRevisions[0]?.id ?? null;
  addToProduct.value = false;
  resetValidation();
  partsPickerRef.value?.resetValidation();
});

function submit() {
  const isEdit = !!subProduct.value;
  // The quantity <input> normally blocks submission natively when cleared
  // — that's disabled (novalidate) in favor of PartsPicker's own inline
  // validation, so it must be checked explicitly here too. Not relevant in
  // edit mode, where the parts picker isn't shown.
  const partsValid = isEdit ? true : (partsPickerRef.value?.validate() ?? true);
  if (!validate() || !partsValid) return;

  emit(
    'saved',
    {
      name: form.name.trim(),
      sku: form.sku?.trim() || null,
      type: form.type.trim(),
      description: form.description?.trim() || null,
      image: form.image,
      parts: isEdit
        ? []
        : selectedParts.value.map((p) => ({
            partId: p.partId,
            quantity: Number(p.quantity),
            unit: p.unit.trim() || null,
            notes: p.notes.trim() || null,
          })),
    },
    isEdit ? null : addToProduct.value ? targetRevisionId.value : null,
  );
}
</script>
