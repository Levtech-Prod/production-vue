<!-- Searchable icon picker for document type cards. Resolves against the
     same curated whitelist the panel renders cards with (utils/documentTypeIcons.ts),
     so whatever is picked here is guaranteed renderable everywhere else. -->
<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="input flex items-center gap-2 text-left"
      @click="open = !open"
    >
      <component :is="resolveIcon(modelValue)" class="h-4 w-4 shrink-0 text-slate-500" />
      <span class="truncate text-slate-700">{{ label(modelValue) }}</span>
    </button>

    <div
      v-if="open"
      class="absolute left-0 z-20 mt-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
      :class="wide ? 'w-[34rem]' : 'w-72'"
    >
      <input
        v-model="search"
        type="text"
        class="input-sm mb-2"
        :placeholder="t('search')"
        @keydown.escape="open = false"
      />

      <!-- `max-h` is a safety net, not the normal case: at 12 columns the whole
           curated set is five rows and fits, so `wide` never scrolls. -->
      <div
        class="grid max-h-56 gap-1 overflow-y-auto"
        :class="wide ? 'grid-cols-12' : 'grid-cols-6'"
      >
        <button
          v-for="icon in filteredIcons"
          :key="icon"
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-lg border transition-colors hover:bg-blue-50"
          :class="
            icon === modelValue
              ? 'border-blue-500 bg-blue-50 text-blue-600'
              : 'border-transparent text-slate-500'
          "
          :title="label(icon)"
          @click="select(icon)"
        >
          <component :is="resolveIcon(icon)" class="h-5 w-5" />
        </button>

        <p
          v-if="filteredIcons.length === 0"
          class="col-span-full py-4 text-center text-sm text-slate-400"
        >
          {{ t('no_search_results') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DOCUMENT_TYPE_ICONS, resolveIcon } from '../utils/documentTypeIcons.ts';

withDefaults(
  defineProps<{
    /** Lay the grid out in 12 columns instead of 6, so the whole set is
     *  visible at once. For callers with the horizontal room — a dialog, not
     *  the settings table cell. */
    wide?: boolean;
  }>(),
  { wide: false },
);

const modelValue = defineModel<string>({ required: true });

const { t } = useI18n();

const open = ref(false);
const search = ref('');
const root = ref<HTMLElement | null>(null);

function label(icon: string): string {
  return icon.replace(/-/g, ' ');
}

const filteredIcons = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return DOCUMENT_TYPE_ICONS;
  return DOCUMENT_TYPE_ICONS.filter((icon) => icon.includes(q));
});

function select(icon: string) {
  modelValue.value = icon;
  open.value = false;
  search.value = '';
}

function onDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>
