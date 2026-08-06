<template>
  <BaseModal
    v-model="open"
    :title="`${t('new_sub_product_revision')}${subProduct ? ' — ' + subProduct.name : ''}`"
    size="xl"
  >
    <form id="spr-form" novalidate class="flex flex-col gap-4" @submit.prevent="submit">
      <div v-if="saveError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ saveError }}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('label') }} <span class="text-red-500">*</span>
          </label>
          <input
            v-model="form.label"
            class="input"
            required
            :placeholder="t('revision_label_placeholder')"
          />
          <p v-if="fieldErrors.label" class="text-xs text-red-500">{{ fieldErrors.label }}</p>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('copy_parts_from') }}
          </label>
          <select v-model="copyFromId" class="input" @change="onCopyFromChange">
            <option :value="null">{{ t('start_empty') }}</option>
            <option
              v-for="rev in subProduct?.revisions ?? []"
              :key="rev.id"
              :value="rev.id"
            >
              {{ rev.label }}
            </option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('copy_documents_from') }}
          </label>
          <select v-model="documentsFromId" class="input">
            <option :value="null">{{ t('copy_documents_from_none') }}</option>
            <option v-for="rev in sortedRevisions" :key="rev.id" :value="rev.id">
              {{ rev.label }}
            </option>
          </select>
          <p class="text-xs text-slate-400">{{ t('copy_documents_from_hint') }}</p>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('change_notes') }}
        </label>
        <textarea v-model="form.changeNotes" rows="2" class="input" />
      </div>

      <PartsPicker ref="partsPickerRef" v-model="selectedParts" />
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="submit" form="spr-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import PartsPicker from './PartsPicker.vue';
import { subProductsApi } from '../../api/productsAPI.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import type {
  DetailSubProduct,
  NewSubProductRevisionPayload,
  SelectedPart,
} from '../../types/products.ts';

const props = defineProps<{
  subProduct?: DetailSubProduct | null;
  saveError?: string | null;
  saving?: boolean;
}>();

const emit = defineEmits<{ saved: [payload: NewSubProductRevisionPayload] }>();

const { t, te } = useI18n();
const notify = useNotificationStore();
const open = defineModel<boolean>({ default: false });

const form = ref<{ label: string; changeNotes: string }>({
  label: '',
  changeNotes: '',
});
const copyFromId = ref<number | null>(null);
// Separate from the parts source: reusing `copyFromId` would make choosing a
// document source re-copy that revision's parts too.
const documentsFromId = ref<number | null>(null);
const selectedParts = ref<SelectedPart[]>([]);
const partsPickerRef = ref<InstanceType<typeof PartsPicker> | null>(null);
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'label', label: t('label'), missing: !form.value.label.trim() },
]);

// Newest first — the likeliest source.
const sortedRevisions = computed(() =>
  [...(props.subProduct?.revisions ?? [])].sort((a, b) => b.revisionNumber - a.revisionNumber),
);

// Prefill the parts list, edited locally then sent explicitly — so we do NOT
// pass duplicateFromId, or a part removed here would return via the server copy.
async function onCopyFromChange() {
  if (!copyFromId.value || !props.subProduct) return;
  try {
    const response = await subProductsApi.getRevisionParts(
      props.subProduct.id,
      copyFromId.value,
    );
    selectedParts.value = response.data.map((p) => ({
      partId: p.id,
      name: p.name,
      code: p.code,
      quantity: Number(p.quantity),
      unit: p.unit ?? '',
      notes: p.notes ?? '',
    }));
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.load_parts_failed'),
      'error',
    );
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  const next = (props.subProduct?.revisions.length ?? 0) + 1;
  form.value = { label: `Rev. ${next}`, changeNotes: '' };
  selectedParts.value = [];
  copyFromId.value = null;
  // Default to newest, so documents keep carrying forward untouched.
  documentsFromId.value = sortedRevisions.value[0]?.id ?? null;
  resetValidation();
  partsPickerRef.value?.resetValidation();
});

function submit() {
  // The quantity <input> normally blocks submission natively when cleared
  // — that's disabled (novalidate) in favor of PartsPicker's own inline
  // validation, so it must be checked explicitly here too.
  const partsValid = partsPickerRef.value?.validate() ?? true;
  if (!validate() || !partsValid) return;

  emit('saved', {
    label: form.value.label.trim(),
    changeNotes: form.value.changeNotes.trim() || null,
    // Parts are sent explicitly below, so the server must not copy them too.
    duplicateFromId: null,
    // null means "no documents", not "fall back to the latest revision".
    documentsFromId: documentsFromId.value,
    parts: selectedParts.value.map((p) => ({
      partId: p.partId,
      quantity: Number(p.quantity),
      unit: p.unit.trim() || null,
      notes: p.notes.trim() || null,
    })),
  });
}
</script>
