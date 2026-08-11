<!-- Tag-style editor for a document type's `allowedExtensions`: committed
     values show as removable chips, the trailing input takes the next one.
     Shared by the settings table row (DocumentTypeRowForm.vue) and the
     Documents panel's add/edit modal (DocumentTypeFormModal.vue), which
     otherwise have no markup in common. -->
<template>
  <div class="flex flex-col items-start gap-2.5 pt-1">
    <!-- Committed values sit above the input rather than inline with it, so
         adding one never moves the field the user is typing in. -->
    <div v-if="extensions.length > 0" class="flex flex-wrap gap-1">
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
          @click="extensions.splice(i, 1)"
        >
          <X class="h-3 w-3" />
        </button>
      </span>
    </div>

    <input
      v-model="pending"
      class="input-sm w-40 shrink-0"
      :placeholder="t('allowed_extensions_placeholder')"
      @keydown.enter.prevent="commit"
      @keydown="onKeydown"
      @blur="commit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';

const extensions = defineModel<string[]>({ required: true });

const { t } = useI18n();
const pending = ref('');

// Extensions are also normalised server-side (documentTypes.schema.ts), but
// doing it here too means the chip the admin sees matches what's saved.
function normalize(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

/** Turn whatever is in the input into a chip. Exposed so a parent can flush
 *  uncommitted text before saving — typing an extension and clicking Save
 *  without pressing Enter must not silently drop it. */
function commit() {
  const value = normalize(pending.value);
  pending.value = '';
  if (!value || value === '.') return;
  if (!extensions.value.includes(value)) extensions.value.push(value);
}

// Comma also commits a chip (in addition to Enter/blur), matching common
// tag-input UX — the comma itself is never inserted into the input.
function onKeydown(event: KeyboardEvent) {
  if (event.key === ',') {
    event.preventDefault();
    commit();
  }
}

defineExpose({ commit });
</script>
