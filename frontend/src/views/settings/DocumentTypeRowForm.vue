<!-- The editable cells for one document type row — used both for a new,
     unsaved row and for an existing row being edited in place. A
     multi-root ("fragment") component: it renders bare <td>s so the caller
     can drop it straight into its own <tr>, alongside a leading grip-handle
     cell that differs between the two cases. -->
<template>
  <td class="border-r border-slate-300 px-2 py-1">
    <div class="flex items-center gap-2">
      <IconPicker v-model="draft.icon" class="w-28 shrink-0" />
      <input
        v-model="draft.name"
        class="input-cell flex-1"
        :placeholder="t('name')"
        @keydown.enter.prevent="save"
      />
    </div>
    <p v-if="nameError" class="mt-0.5 text-xs text-red-500">{{ nameError }}</p>
  </td>

  <td class="border-r border-slate-300 px-2 py-1">
    <ChipsInput
      ref="extensionsInput"
      v-model="draft.allowedExtensions"
      :placeholder="t('allowed_extensions_placeholder')"
      :normalize="normalizeExtensionChip"
    />
  </td>

  <td class="border-r border-slate-300 px-2 py-1 text-center">
    <input v-model="draft.required" type="checkbox" class="mt-2 rounded" />
  </td>

  <td class="px-2 py-1">
    <div class="flex items-center justify-end gap-1">
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50"
        :disabled="saving"
        :title="t('save')"
        @click="save"
      >
        <Check class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50"
        :disabled="saving"
        :title="t('cancel')"
        @click="$emit('cancel')"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </td>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, X } from 'lucide-vue-next';
import IconPicker from '../../components/IconPicker.vue';
import ChipsInput from '../../components/ChipsInput.vue';
import { normalizeExtensionChip } from '../../utils/documentTypeDraft.ts';
import type { DocumentTypeDraft } from '../../types/documentTypes.ts';

defineProps<{
  saving?: boolean;
  nameError?: string | null;
}>();

const emit = defineEmits<{
  save: [];
  cancel: [];
}>();

const draft = defineModel<DocumentTypeDraft>({ required: true });

const { t } = useI18n();
const extensionsInput = ref<InstanceType<typeof ChipsInput> | null>(null);

// Flush any not-yet-committed extension text before saving, so typing an
// extension and immediately clicking Save (without pressing Enter) doesn't
// silently drop it.
function save() {
  extensionsInput.value?.commit();
  emit('save');
}
</script>
