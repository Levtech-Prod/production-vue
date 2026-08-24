<template>
  <!-- Sized independently of the ordinary document cards: a versioned card has
       no file list to show, so it stays compact instead of padding itself out
       to match. Equal height across the section comes from the grid — the
       wrapper stretches (no `self-start`, unlike DocumentTypeCard) and the
       button fills it, so the footer bar sits on the bottom edge of every card
       in a row whatever its name or status.

       The whole card is one <button>, so every element inside it is a <span>:
       a <div>/<p>/<ul> would be invalid button content, and the actions menu
       floats over the card rather than nesting inside it. -->
  <div class="relative">
    <div v-if="canManageType" ref="actionsRoot" class="absolute right-2 top-2 z-10">
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        :class="{ 'bg-slate-100 text-slate-600': actionsOpen }"
        :title="t('document_type_actions')"
        :aria-label="t('document_type_actions')"
        :aria-expanded="actionsOpen"
        @click="actionsOpen = !actionsOpen"
      >
        <Settings class="h-3.5 w-3.5" />
      </button>

      <div
        v-if="actionsOpen"
        class="absolute right-0 top-full mt-1 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      >
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
          :title="t('edit_document_type')"
          @click="runAction('edit-type')"
        >
          <Pencil class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
          :title="t('delete_document_type')"
          @click="runAction('delete-type')"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <button
      type="button"
      class="flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
      @click="emit('open')"
    >
      <!-- Header: icon tile, name, production version, count + status badge.
           `flex-1` so the footer stays on the bottom edge when the grid row
           stretches this card past its natural height. -->
      <span class="flex w-full flex-1 items-start gap-3 p-4">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          :class="tile.bg"
        >
          <component :is="icon" class="h-5 w-5" :class="tile.fg" />
        </span>

        <span class="min-w-0 flex-1">
          <!-- Right padding keeps a long name from running under the actions
               button, which is out of flow and cannot push it. -->
          <span
            class="block truncate text-sm font-semibold text-slate-800"
            :class="{ 'pr-8': canManageType }"
            :title="name"
          >
            {{ name }}
          </span>

          <!-- Always rendered (non-breaking space when there is no production
               version) so a card with one and a card without stay level. -->
          <span class="block truncate text-[11px] leading-4 text-emerald-700">
            {{ productionName ? t('version_production_is', { name: productionName }) : ' ' }}
          </span>

          <span class="mt-0.5 flex items-center justify-between gap-2">
            <span class="text-xs text-slate-500">{{ t('version_count', versionCount) }}</span>
            <span
              class="inline-flex shrink-0 cursor-help items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
              :class="badge.classes"
              :title="t(badge.hintKey)"
            >
              <component :is="badge.icon" class="h-3 w-3" />
              {{ t(badge.labelKey) }}
            </span>
          </span>
        </span>
      </span>

      <span
        class="flex h-[2.375rem] w-full shrink-0 items-center justify-between border-t border-slate-100 px-4 text-xs text-slate-500"
      >
        {{ t('open_versions') }}
        <ChevronRight class="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronRight, Pencil, Settings, Trash2 } from 'lucide-vue-next';
import { resolveIcon } from '../../../../utils/documentTypeIcons.ts';
import { documentStatusBadge, documentTile } from '../../../../utils/documentCardStyle.ts';
import type { DocumentTypeStatus } from '../../../../types/products.ts';

const props = withDefaults(
  defineProps<{
    name: string;
    iconName: string;
    status: DocumentTypeStatus;
    versionCount: number;
    productionName: string | null;
    /** Drives the icon tile colour, exactly as on an ordinary card. */
    colorSeed?: number;
    /** Whether the viewer may change document types at all (admin). */
    canManageType?: boolean;
  }>(),
  { canManageType: false },
);

const emit = defineEmits<{
  /** Swap the right panel over to this card's versions. */
  (e: 'open'): void;
  (e: 'edit-type'): void;
  (e: 'delete-type'): void;
}>();

const { t } = useI18n();

const icon = computed(() => resolveIcon(props.iconName));
const tile = computed(() => documentTile(props.colorSeed));
const badge = computed(() => documentStatusBadge(props.status));

const actionsOpen = ref(false);
const actionsRoot = ref<HTMLElement | null>(null);

// Branching rather than `emit(action)`: the emit type is a set of overloads,
// so it rejects a union-typed event name.
function runAction(action: 'edit-type' | 'delete-type') {
  actionsOpen.value = false;
  if (action === 'edit-type') emit('edit-type');
  else emit('delete-type');
}

function onDocumentClick(event: MouseEvent) {
  if (actionsOpen.value && !actionsRoot.value?.contains(event.target as Node)) {
    actionsOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>
