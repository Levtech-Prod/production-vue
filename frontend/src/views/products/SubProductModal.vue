<template>
  <BaseModal v-model="open" :title="t('new_sub_product')" size="lg">
    <form id="sub-product-form" class="flex flex-col gap-4" @submit.prevent="submit">
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
        target="sub-products"
        :preview-alt="form.name"
      />

      <PartsPicker v-model="selectedParts" />

      <!-- Optionally link the new sub-product to a product revision -->
      <div class="rounded-xl border border-slate-200 p-3">
        <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            v-model="addToProduct"
            type="checkbox"
            class="h-4 w-4 rounded border-slate-300"
            :disabled="!productRevisions.length"
          />
          {{ t('add_to_product') }}
        </label>
        <p class="mt-1 text-xs text-slate-400">{{ t('add_to_product_hint') }}</p>

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
      <button type="submit" form="sub-product-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import ImageUploadField from '../../components/uploader/ImageUploadField.vue';
import PartsPicker from './PartsPicker.vue';
import type {
  SubProductPayload,
  SelectedPart,
  ProductRevision,
} from '../../types/products.ts';

const props = withDefaults(
  defineProps<{
    saveError?: string | null;
    saving?: boolean;
    // Revisions of the current product, offered as link targets.
    productRevisions?: ProductRevision[];
    // Pre-selected target revision (e.g. the one currently selected on screen).
    defaultRevisionId?: number | null;
  }>(),
  { productRevisions: () => [] },
);

const emit = defineEmits<{
  saved: [payload: SubProductPayload, addToRevisionId: number | null];
}>();

const { t } = useI18n();
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

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.name = '';
  form.sku = '';
  form.type = '';
  form.description = '';
  form.image = '';
  selectedParts.value = [];
  // Default the link target to the currently selected revision, if any.
  targetRevisionId.value =
    props.defaultRevisionId ?? props.productRevisions[0]?.id ?? null;
  addToProduct.value = false;
});

function submit() {
  emit(
    'saved',
    {
      name: form.name.trim(),
      sku: form.sku.trim(),
      type: form.type?.trim() || null,
      description: form.description?.trim() || null,
      image: form.image || null,
      parts: selectedParts.value.map((p) => ({
        partId: p.partId,
        quantity: Number(p.quantity),
        unit: p.unit.trim() || null,
        notes: p.notes.trim() || null,
      })),
    },
    addToProduct.value ? targetRevisionId.value : null,
  );
}
</script>
