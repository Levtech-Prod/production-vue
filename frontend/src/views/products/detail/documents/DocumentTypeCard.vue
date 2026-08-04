<template>
  <!-- `.card` is unlayered in this project and would override Tailwind
       utilities, so the card surface is styled with plain utilities here. -->
  <!-- `self-start` keeps the height fixed: grid items stretch by default, so
       without it a taller neighbour in the same row would pull the card up. -->
  <div
    class="flex flex-col self-start rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
  >
    <!-- Header: icon tile, name, file count, status badge -->
    <div class="flex items-start gap-3 p-4">
      <div
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        :class="tile.bg"
      >
        <component :is="icon" class="h-5 w-5" :class="tile.fg" />
      </div>

      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-slate-800" :title="name">
          {{ name }}
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
            <a
              :href="file.downloadUrl"
              class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              :title="t('download')"
              @click.stop
            >
              <Download class="h-3.5 w-3.5" />
            </a>
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

    <!-- Footer: what this card accepts, plus the upload action. Opening a file
         happens by clicking its name above. -->
    <div class="flex items-center gap-2 border-t border-slate-100 px-2 py-2">
      <!-- Always rendered (non-breaking space when unrestricted) so the footer,
           and so the card, keeps the same height in every state. -->
      <span
        class="min-w-0 flex-1 truncate px-2 py-1 font-mono text-[11px] text-slate-400"
        :title="extensionsTitle"
      >
        {{ extensionsLabel }}
      </span>

      <label
        v-if="canEdit"
        class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        :title="acceptHint"
      >
        <Upload class="h-3.5 w-3.5" />
        {{ t('upload') }}
        <input type="file" class="sr-only" :accept="acceptAttr" @change="onUploadFile" />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, Circle, Download, RefreshCw, Trash2, Upload, X } from 'lucide-vue-next';
import { resolveIcon } from '../../../../utils/documentTypeIcons.ts';
import { formatBytes } from '../../../../utils/formatters.ts';
import type { DocumentTypeStatus, ProductDocument } from '../../../../types/products.ts';

const props = defineProps<{
  name: string;
  /** Icon name from the curated set; anything unknown falls back to a file. */
  iconName: string;
  status: DocumentTypeStatus;
  files: ProductDocument[];
  /** Empty = the card accepts anything the server's global list allows. */
  allowedExtensions: string[];
  canEdit: boolean;
  /** Drives the icon tile colour; omit for the "Other documents" card. */
  colorSeed?: number;
}>();

const emit = defineEmits<{
  (e: 'upload-file', file: File): void;
  (e: 'replace-file', doc: ProductDocument, file: File): void;
  (e: 'delete-file', doc: ProductDocument): void;
  /** Open the full file list for this card in a modal. */
  (e: 'show-all'): void;
}>();

const { t } = useI18n();

const icon = computed(() => resolveIcon(props.iconName));

// How many files the card lists before deferring to the modal. Two is what
// fits the fixed-height file box alongside the "+N more" line — and in practice
// most cards hold a single file, so the overflow path is the exception.
const LISTED_COUNT = 2;

const visibleFiles = computed(() => props.files.slice(0, LISTED_COUNT));
const hiddenCount = computed(() => Math.max(props.files.length - LISTED_COUNT, 0));

// A stable pastel per card, keyed off the document type id, so the grid reads
// as distinct tiles (as in the design) without storing a colour per template.
const TILES = [
  { bg: 'bg-emerald-50', fg: 'text-emerald-600' },
  { bg: 'bg-blue-50', fg: 'text-blue-600' },
  { bg: 'bg-violet-50', fg: 'text-violet-600' },
  { bg: 'bg-amber-50', fg: 'text-amber-600' },
  { bg: 'bg-rose-50', fg: 'text-rose-600' },
  { bg: 'bg-cyan-50', fg: 'text-cyan-600' },
  { bg: 'bg-lime-50', fg: 'text-lime-600' },
  { bg: 'bg-fuchsia-50', fg: 'text-fuchsia-600' },
];
const NEUTRAL_TILE = { bg: 'bg-slate-100', fg: 'text-slate-500' };

const tile = computed(() =>
  props.colorSeed == null ? NEUTRAL_TILE : TILES[props.colorSeed % TILES.length],
);

const BADGES = {
  complete: {
    icon: Check,
    labelKey: 'doc_status_complete',
    hintKey: 'doc_status_complete_hint',
    classes: 'bg-emerald-50 text-emerald-700',
  },
  missing: {
    icon: X,
    labelKey: 'doc_status_missing',
    hintKey: 'doc_status_missing_hint',
    classes: 'bg-red-50 text-red-600',
  },
  optional: {
    icon: Circle,
    labelKey: 'doc_status_optional',
    hintKey: 'doc_status_optional_hint',
    classes: 'bg-slate-100 text-slate-500',
  },
} as const;

const badge = computed(() => BADGES[props.status]);

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

// Shown in the footer. A non-breaking space rather than nothing, so the row
// still occupies its line when the card accepts anything.
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
