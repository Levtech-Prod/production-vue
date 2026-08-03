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
    <div class="flex flex-wrap items-center gap-1">
      <span
        v-for="(ext, i) in draft.allowedExtensions"
        :key="ext"
        class="badge inline-flex items-center gap-1 bg-slate-100 text-slate-700"
      >
        {{ ext }}
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-slate-200"
          :aria-label="t('delete')"
          @click="draft.allowedExtensions.splice(i, 1)"
        >
          <X class="h-3 w-3" />
        </button>
      </span>

      <input
        v-model="extensionInput"
        class="input-sm min-w-[6rem] flex-1"
        :placeholder="draft.allowedExtensions.length === 0 ? t('allowed_extensions_placeholder') : ''"
        @keydown.enter.prevent="commitExtension"
        @keydown="onExtensionKeydown"
        @blur="commitExtension"
      />
    </div>
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
const extensionInput = ref('');

// Extensions are also normalised server-side (documentTypes.schema.ts), but
// doing it here too means the chip the admin sees matches what's saved.
function normalizeExtension(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function commitExtension() {
  const value = normalizeExtension(extensionInput.value);
  extensionInput.value = '';
  if (!value || value === '.') return;
  if (!draft.value.allowedExtensions.includes(value)) draft.value.allowedExtensions.push(value);
}

// Comma also commits a chip (in addition to Enter/blur), matching common
// tag-input UX — the comma itself is never inserted into the input.
function onExtensionKeydown(event: KeyboardEvent) {
  if (event.key === ',') {
    event.preventDefault();
    commitExtension();
  }
}

// Flush any not-yet-committed extension text before saving, so typing an
// extension and immediately clicking Save (without pressing Enter) doesn't
// silently drop it.
function save() {
  commitExtension();
  emit('save');
}
</script>
