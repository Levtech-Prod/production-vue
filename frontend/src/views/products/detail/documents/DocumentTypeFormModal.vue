<!-- Add or edit a document type that belongs to THIS product / sub-product
     alone. Same four fields as the settings table row
     (settings/DocumentTypeRowForm.vue), laid out as a form rather than table
     cells; the extension editor itself is shared between the two. -->
<template>
  <!-- `lg` so the icon picker can lay its whole set out in one un-scrolled
       grid (see `wide` below). -->
  <BaseModal v-model="open" :title="title" size="lg">
    <!-- BaseModal's body is `overflow-y-auto`, which clips the picker's
         absolutely positioned dropdown and turns it into a scroll. The
         min-height reserves the room the open dropdown needs, so it never
         does. -->
    <div class="flex min-h-[24rem] flex-col gap-3">
      <!-- Called out rather than stated quietly: the scope is the one thing
           about this dialog that is easy to get wrong, and it is not
           recoverable by simply editing the card afterwards. -->
      <p
        class="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
      >
        <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>{{ t('document_type_scope_hint') }}</span>
      </p>

      <div>
        <label class="mb-2 block text-xs font-medium text-slate-500">
          {{ t('name') }}
        </label>
        <div class="flex items-start gap-3">
          <IconPicker v-model="draft.icon" wide class="w-40 shrink-0" />
          <input
            v-model="draft.name"
            type="text"
            class="input flex-1"
            :placeholder="t('name')"
            @keyup.enter="submit"
          />
        </div>
        <p v-if="nameError" class="mt-2 text-xs text-red-500">
          {{ nameError }}
        </p>
      </div>

      <div>
        <label class="mb-2 block text-xs font-medium text-slate-500">
          {{ t('allowed_extensions') }}
        </label>
        <ChipsInput
          ref="extensionsInput"
          v-model="draft.allowedExtensions"
          :placeholder="t('allowed_extensions_placeholder')"
          :normalize="normalizeExtensionChip"
        />
        <p class="mt-2 text-xs text-slate-400">
          {{ t('allowed_extensions_any_hint') }}
        </p>
      </div>

      <label class="flex items-center gap-2.5 text-sm text-slate-600">
        <input v-model="draft.required" type="checkbox" class="rounded" />
        {{ t('required_document_hint') }}
      </label>

      <p
        v-if="saveError"
        class="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-600"
      >
        {{ saveError }}
      </p>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button
        type="button"
        class="btn-primary"
        :disabled="saving"
        @click="submit"
      >
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TriangleAlert } from 'lucide-vue-next';
import BaseModal from '../../../../components/modal/BaseModal.vue';
import IconPicker from '../../../../components/IconPicker.vue';
import ChipsInput from '../../../../components/ChipsInput.vue';
import { documentTypeNameError, normalizeExtensionChip } from '../../../../utils/documentTypeDraft.ts';
import type { DocumentTypeDraft } from '../../../../types/documentTypes.ts';

const props = defineProps<{
  saving: boolean;
  saveError: string | null;
}>();

const emit = defineEmits<{ (e: 'confirm'): void }>();

const { t } = useI18n();

const open = defineModel<boolean>({ default: false });
const draft = defineModel<DocumentTypeDraft>('draft', { required: true });

// An existing row carries an id; a new one does not.
const title = computed(() =>
  draft.value.id == null ? t('add_document_type') : t('edit_document_type'),
);

const nameError = ref<string | null>(null);
const extensionsInput = ref<InstanceType<typeof ChipsInput> | null>(
  null,
);

function submit() {
  if (props.saving) return;
  // Flush uncommitted extension text, as the settings row does — typing an
  // extension and clicking Save without pressing Enter must not drop it.
  extensionsInput.value?.commit();

  nameError.value = documentTypeNameError(draft.value, t);
  if (nameError.value) return;
  emit('confirm');
}
</script>
