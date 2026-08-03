<template>
  <BaseModal v-model="open" :title="title" size="sm">
    <form
      id="document-type-form"
      novalidate
      class="flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <div v-if="saveError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ saveError }}
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('name') }} <span class="text-red-500">*</span>
        </label>
        <input v-model="name" class="input" required />
        <p v-if="fieldErrors.name" class="text-xs text-red-500">{{ fieldErrors.name }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('icon') }}
        </label>
        <IconPicker v-model="icon" />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ t('allowed_extensions') }}
        </label>
        <p class="text-xs text-slate-400">{{ t('allowed_extensions_hint') }}</p>

        <div class="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-2">
          <span
            v-for="(ext, i) in extensions"
            :key="ext"
            class="badge inline-flex items-center gap-1 bg-slate-100 text-slate-700"
          >
            {{ ext }}
            <button
              type="button"
              class="rounded-full p-0.5 hover:bg-slate-200"
              :aria-label="t('delete')"
              @click="removeExtension(i)"
            >
              <X class="h-3 w-3" />
            </button>
          </span>

          <input
            v-model="extensionInput"
            type="text"
            class="min-w-[8rem] flex-1 border-none bg-transparent px-1 py-1 text-sm outline-none"
            :placeholder="extensions.length === 0 ? t('allowed_extensions_placeholder') : ''"
            @keydown.enter.prevent="commitExtension"
            @keydown="onExtensionKeydown"
            @blur="commitExtension"
          />
        </div>
      </div>

      <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input v-model="required" type="checkbox" class="rounded" />
        {{ t('required') }}
      </label>
    </form>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="submit" form="document-type-form" class="btn-primary" :disabled="saving">
        {{ saving ? t('saving') : t('save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';
import BaseModal from '../../components/modal/BaseModal.vue';
import IconPicker from '../../components/IconPicker.vue';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import type { DocumentTypePayload } from '../../types/documentTypes.ts';

const DEFAULT_ICON = 'file';

const props = defineProps<{
  title: string;
  initial?: DocumentTypePayload | null;
  saveError?: string | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  saved: [payload: DocumentTypePayload];
}>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const name = ref('');
const icon = ref(DEFAULT_ICON);
const extensions = ref<string[]>([]);
const extensionInput = ref('');
const required = ref(true);

const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  { key: 'name', label: t('name'), missing: !name.value.trim() },
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = props.initial?.name ?? '';
  icon.value = props.initial?.icon ?? DEFAULT_ICON;
  extensions.value = [...(props.initial?.allowedExtensions ?? [])];
  extensionInput.value = '';
  required.value = props.initial?.required ?? true;
  resetValidation();
});

// Extensions also get normalised server-side (see documentTypes.schema.ts),
// but doing it here too means the chip the admin sees matches what's saved.
function normalizeExtension(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function commitExtension() {
  const value = normalizeExtension(extensionInput.value);
  extensionInput.value = '';
  if (!value || value === '.') return;
  if (!extensions.value.includes(value)) extensions.value.push(value);
}

// Comma also commits a chip (in addition to Enter/blur), matching common
// tag-input UX — the comma itself is never inserted into the input.
function onExtensionKeydown(event: KeyboardEvent) {
  if (event.key === ',') {
    event.preventDefault();
    commitExtension();
  }
}

function removeExtension(index: number) {
  extensions.value.splice(index, 1);
}

function submit() {
  if (!validate()) return;
  commitExtension();
  emit('saved', {
    name: name.value.trim(),
    icon: icon.value,
    allowedExtensions: extensions.value,
    required: required.value,
  });
}
</script>
