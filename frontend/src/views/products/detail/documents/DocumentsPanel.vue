<template>
  <div class="flex-1 overflow-y-auto">
    <div class="px-4 pb-4 pt-3">
      <!-- Header: title, plus the counts as stat chips on the right. They sit
           here rather than among the cards so they read as a summary OF the
           grid instead of another card in it — and the title row was empty
           space anyway, so they cost no vertical room. -->
      <div
        class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-100 pb-2"
      >
        <span class="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
          {{ title }}
        </span>

        <dl
          v-if="!loading && docs.documentTypes.length > 0"
          class="flex shrink-0 items-center gap-3 text-[11px]"
        >
          <div v-for="stat in stats" :key="stat.labelKey" class="flex items-baseline gap-1">
            <dd class="font-semibold" :class="stat.valueClass">{{ stat.value }}</dd>
            <dt class="text-slate-400">{{ t(stat.labelKey) }}</dt>
          </div>
        </dl>
      </div>

      <div v-if="loading" class="py-6 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </div>

      <template v-else>
        <!-- No requirements defined for this product/sub-product type yet:
             ad-hoc uploads still work, so explain where they come from. -->
        <p
          v-if="docs.documentTypes.length === 0"
          class="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500"
        >
          {{ t('no_document_types_hint') }}
        </p>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <DocumentTypeCard
            v-for="(group, index) in docs.documentTypes"
            :key="group.id"
            :name="group.name"
            :icon-name="group.icon"
            :status="group.status"
            :files="group.files"
            :allowed-extensions="group.allowedExtensions"
            :can-edit="canEdit"
            :color-seed="index"
            @upload-file="(file) => emit('upload-file', file, group.id)"
            @replace-file="(doc, file) => emit('replace-file', doc, file)"
            @delete-file="(doc) => emit('delete-doc', doc)"
            @link-file="emit('link-doc', group.id, group.name)"
            @show-all="openGroupId = group.id"
          />

          <!-- Catch-all bucket: anything uploaded without a document type. -->
          <DocumentTypeCard
            :name="t('other_documents')"
            icon-name="file-stack"
            status="optional"
            :files="docs.other"
            :allowed-extensions="[]"
            :can-edit="canEdit"
            @upload-file="(file) => emit('upload-file', file, null)"
            @replace-file="(doc, file) => emit('replace-file', doc, file)"
            @delete-file="(doc) => emit('delete-doc', doc)"
            @link-file="emit('link-doc', null, t('other_documents'))"
            @show-all="openGroupId = OTHER_GROUP"
          />
        </div>
      </template>
    </div>

    <!-- Full file list for one card, with always-visible actions. -->
    <DocumentFilesModal
      v-model="filesModalOpen"
      :group="openGroup"
      :can-edit="canEdit"
      @upload-file="(file) => emit('upload-file', file, openDocumentTypeId)"
      @replace-file="(doc, file) => emit('replace-file', doc, file)"
      @delete-file="(doc) => emit('delete-doc', doc)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DocumentTypeCard from './DocumentTypeCard.vue';
import DocumentFilesModal, { type DocumentFilesGroup } from './DocumentFilesModal.vue';
import type { ProductDocument, RevisionDocuments } from '../../../../types/products.ts';

const props = defineProps<{
  title: string;
  docs: RevisionDocuments;
  loading: boolean;
  canEdit: boolean;
}>();

const emit = defineEmits<{
  /** `documentTypeId` null means the "Other documents" bucket. */
  (e: 'upload-file', file: File, documentTypeId: number | null): void;
  (e: 'replace-file', doc: ProductDocument, file: File): void;
  (e: 'delete-doc', doc: ProductDocument): void;
  /** `documentTypeId` null = "Other documents"; the name titles the modal. */
  (e: 'link-doc', documentTypeId: number | null, cardName: string): void;
}>();

const { t } = useI18n();

// Header stats. "Missing" only turns red when there actually is something
// missing, so a fully satisfied revision reads as calm rather than alarming.
const stats = computed(() => [
  {
    labelKey: 'total_types',
    value: props.docs.summary.totalTypes,
    valueClass: 'text-slate-600',
  },
  {
    labelKey: 'doc_status_complete',
    value: props.docs.summary.uploaded,
    valueClass: 'text-emerald-600',
  },
  {
    labelKey: 'doc_status_missing',
    value: props.docs.summary.missing,
    valueClass: props.docs.summary.missing > 0 ? 'text-red-600' : 'text-slate-400',
  },
]);

/** Stands in for the "Other documents" card, which has no document type id. */
const OTHER_GROUP = 'other' as const;

// The open card is tracked by id, not by a copied snapshot, so the modal
// re-derives from `docs` and stays current when a mutation refetches the panel.
const openGroupId = ref<number | typeof OTHER_GROUP | null>(null);

const openGroup = computed<DocumentFilesGroup | null>(() => {
  if (openGroupId.value === null) return null;
  if (openGroupId.value === OTHER_GROUP) {
    return { name: t('other_documents'), allowedExtensions: [], files: props.docs.other };
  }
  const group = props.docs.documentTypes.find((g) => g.id === openGroupId.value);
  return group
    ? { name: group.name, allowedExtensions: group.allowedExtensions, files: group.files }
    : null;
});

/** What an upload from inside the modal should be filed under. */
const openDocumentTypeId = computed(() =>
  typeof openGroupId.value === 'number' ? openGroupId.value : null,
);

const filesModalOpen = computed({
  get: () => openGroupId.value !== null,
  set: (value) => {
    if (!value) openGroupId.value = null;
  },
});
</script>
