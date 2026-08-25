<template>
  <!-- `.card` is unlayered in this project and would override Tailwind
       utilities, so the card surface is styled with plain utilities here. -->
  <!-- `self-start` keeps the height fixed: grid items stretch by default, so
       without it a taller neighbour in the same row would pull the card up. -->
  <div
    class="relative flex flex-col self-start rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
  >
    <!-- Corner cluster: what this card is, and what can be done to it.
         Out of flow so it never competes with the name for width. -->
    <div class="absolute right-2 top-2 z-10 flex items-center gap-1.5">
      <!-- Marks a card this product defines for itself, as opposed to one
           every product of its type inherits — which is also why only these
           get the actions button beside it. -->
      <span
        v-if="custom"
        class="inline-flex cursor-help items-center rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700"
        :title="t('custom_document_type_hint')"
      >
        {{ t('custom_document_type') }}
      </span>

      <!-- An inherited card is edited from Settings, where its whole type is,
           so it gets no menu at all. -->
      <div v-if="custom && canManageType" ref="actionsRoot" class="relative">
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
    </div>

    <!-- Header: icon tile, name, file count, status badge -->
    <div class="flex items-start gap-3 p-4">
      <div
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        :class="tile.bg"
      >
        <component :is="icon" class="h-5 w-5" :class="tile.fg" />
      </div>

      <div class="min-w-0 flex-1">
        <!-- Right padding keeps a long name from running under the corner
             cluster, which is out of flow and cannot push it. -->
        <p
          class="truncate text-sm font-semibold text-slate-800"
          :class="{ 'pr-20': custom }"
          :title="name"
        >
          {{ name }}
        </p>

        <!-- What the card accepts: a property of the type, so it sits with the
             name rather than among the footer actions. Always rendered
             (non-breaking space when unrestricted) to keep cards equal height. -->
        <p
          class="truncate font-mono text-[11px] leading-4 text-slate-400"
          :title="extensionsTitle"
        >
          {{ extensionsLabel }}
        </p>

        <div class="mt-0.5 flex items-center justify-between gap-2">
          <!-- Also the one non-hover route to the file actions, which matters
               on touch: the card's per-file icons only appear on hover. -->
          <button
            v-if="files.length > 0"
            type="button"
            class="rounded text-xs text-slate-500 hover:text-blue-600 hover:underline"
            :title="t('manage_files')"
            @click="emit('show-all')"
          >
            {{ t('n_files', files.length) }}
          </button>
          <span v-else class="text-xs text-slate-500">{{ t('n_files', 0) }}</span>
          <!-- The status wording is terse by design; the tooltip carries what
               each one actually means (it used to be a legend box). -->
          <span
            class="inline-flex shrink-0 cursor-help items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            :class="badge.classes"
            :title="t(badge.hintKey)"
          >
            <component :is="badge.icon" class="h-3 w-3" />
            {{ t(badge.labelKey) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Files, or the empty hint.
         Fixed height in EVERY state so all cards line up: it fits exactly the
         two listed rows plus the "+N more" line (3 × 1.5rem). Anything beyond
         that is handled in the modal rather than by growing the card. -->
    <div class="h-[4.5rem] overflow-hidden px-4 pb-3">
      <p v-if="files.length === 0" class="text-xs leading-6 text-slate-400">
        {{ t('no_uploaded_file') }}
      </p>
      <ul v-else>
        <li
          v-for="file in visibleFiles"
          :key="file.id"
          class="group flex h-6 items-center gap-1.5 rounded-md pl-1 pr-0.5 hover:bg-slate-50"
        >
          <span class="shrink-0 text-slate-300">&bull;</span>
          <a
            :href="file.path"
            target="_blank"
            rel="noopener"
            class="min-w-0 flex-1 truncate text-xs text-slate-600 hover:text-blue-600 hover:underline"
            :title="`${file.originalName} — ${formatBytes(file.sizeBytes)}`"
          >
            {{ file.originalName }}
          </a>

          <!-- Per-file actions, revealed on hover (and kept reachable by
               keyboard via focus-within on the row). -->
          <span
            class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <button
              type="button"
              class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              :title="t('download')"
              @click.stop="download(file.downloadUrl, file.originalName)"
            >
              <Download class="h-3.5 w-3.5" />
            </button>
            <label
              v-if="canEdit"
              class="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              :title="t('replace_document')"
            >
              <RefreshCw class="h-3.5 w-3.5" />
              <input
                type="file"
                class="sr-only"
                :accept="acceptAttr"
                @change="onReplaceFile($event, file)"
              />
            </label>
            <button
              v-if="canEdit"
              type="button"
              class="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              :title="t('delete_document')"
              @click="emit('delete-file', file)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </span>
        </li>

        <!-- The overflow lives in the modal, so the card height never moves. -->
        <li v-if="hiddenCount > 0" class="h-6">
          <button
            type="button"
            class="rounded px-1 text-xs leading-6 text-slate-400 hover:text-blue-600 hover:underline"
            @click="emit('show-all')"
          >
            {{ t('show_more_files', { n: hiddenCount }) }}
          </button>
        </li>
      </ul>
    </div>

    <!-- The two ways to add a file. Rendered even when read-only, so archived
         products' cards keep the same height. -->
    <div class="flex h-[2.375rem] items-center justify-between border-t border-slate-100 px-2">
      <template v-if="canEdit">
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          :title="t('link_document_hint')"
          @click="emit('link-file')"
        >
          <Link2 class="h-3.5 w-3.5" />
          {{ t('link_document') }}
        </button>

        <label
          class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          :title="acceptHint"
        >
          <Upload class="h-3.5 w-3.5" />
          {{ t('upload') }}
          <input type="file" class="sr-only" :accept="acceptAttr" @change="onUploadFile" />
        </label>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, Link2, Pencil, RefreshCw, Settings, Trash2, Upload } from 'lucide-vue-next';
import { resolveIcon } from '../../../../utils/documentTypeIcons.ts';
import {
  documentStatusBadge,
  documentTile,
} from '../../../../utils/documentCardStyle.ts';
import { formatBytes } from '../../../../utils/formatters.ts';
import { useFileDownload } from '../../../../composables/useFileDownload.ts';
import type { DocumentTypeStatus, ProductDocument } from '../../../../types/products.ts';

const props = withDefaults(
  defineProps<{
    name: string;
    /** Icon name from the curated set; anything unknown falls back to a file. */
    iconName: string;
    status: DocumentTypeStatus;
    files: ProductDocument[];
    /** Empty = the card accepts anything the server's global list allows. */
    allowedExtensions: string[];
    canEdit: boolean;
    /** Defined on this product / sub-product rather than inherited from its
     *  type — badged, and editable in place. */
    custom?: boolean;
    /** Whether the viewer may change document types at all (admin). */
    canManageType?: boolean;
    /** Drives the icon tile colour; omit for the "Other documents" card. */
    colorSeed?: number;
  }>(),
  { custom: false, canManageType: false },
);

const emit = defineEmits<{
  (e: 'upload-file', file: File): void;
  (e: 'replace-file', doc: ProductDocument, file: File): void;
  (e: 'delete-file', doc: ProductDocument): void;
  /** Open the "use a file from another revision" picker for this card. */
  (e: 'link-file'): void;
  /** Open the full file list for this card in a modal. */
  (e: 'show-all'): void;
  /** Edit / delete this card's document type (custom cards only). */
  (e: 'edit-type'): void;
  (e: 'delete-type'): void;
}>();

const { t } = useI18n();
const { download } = useFileDownload();

const icon = computed(() => resolveIcon(props.iconName));

// ── Document type actions (custom cards only) ──────────────────────────────
// Kept behind a menu rather than sitting in the footer: editing the card's
// definition is a rarer, heavier act than the file actions it would sit
// beside, and shouldn't be one stray click away.

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

// How many files the card lists before deferring to the modal. Two is what
// fits the fixed-height file box alongside the "+N more" line — and in practice
// most cards hold a single file, so the overflow path is the exception.
const LISTED_COUNT = 2;

const visibleFiles = computed(() => props.files.slice(0, LISTED_COUNT));
const hiddenCount = computed(() => Math.max(props.files.length - LISTED_COUNT, 0));

const tile = computed(() => documentTile(props.colorSeed));
const badge = computed(() => documentStatusBadge(props.status));

const restricted = computed(() => props.allowedExtensions.length > 0);

// Restricts the file picker to what this card takes; empty means no filter.
const acceptAttr = computed(() =>
  restricted.value ? props.allowedExtensions.join(',') : undefined,
);
const acceptHint = computed(() =>
  restricted.value
    ? t('allowed_extensions_hint', { list: props.allowedExtensions.join(', ') })
    : t('upload_document'),
);

// A non-breaking space rather than nothing, so the line keeps its row.
const extensionsLabel = computed(() =>
  restricted.value ? props.allowedExtensions.join(' ') : ' ',
);
const extensionsTitle = computed(() => (restricted.value ? acceptHint.value : undefined));

/** Read the picked file, then reset the input so the same file can be
 *  re-selected later (the change event won't fire for an identical value). */
function takeFile(event: Event): File | null {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = '';
  return file;
}

function onUploadFile(event: Event) {
  const file = takeFile(event);
  if (file) emit('upload-file', file);
}

function onReplaceFile(event: Event, doc: ProductDocument) {
  const file = takeFile(event);
  if (file) emit('replace-file', doc, file);
}
</script>
