<template>
  <div class="flex-1 overflow-y-auto">
    <div class="px-4 pb-4 pt-3">
      <span class="mb-3 block min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
        {{ title }}
      </span>

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
            @show-all="openGroupId = OTHER_GROUP"
          />

          <!-- Counts. Only meaningful once requirements exist. Each status is
               explained by its badge tooltip on the cards themselves. -->
          <div
            v-if="docs.documentTypes.length > 0"
            class="h-fit rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <p class="mb-2 text-xs font-semibold text-slate-600">
              {{ t('document_types') }}
            </p>
            <dl class="flex flex-col gap-1 text-[11px] text-slate-500">
              <div class="flex items-center justify-between">
                <dt>{{ t('total_types') }}</dt>
                <dd class="font-semibold text-slate-700">{{ docs.summary.totalTypes }}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt>{{ t('doc_status_complete') }}</dt>
                <dd class="font-semibold text-emerald-600">{{ docs.summary.uploaded }}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt>{{ t('doc_status_missing') }}</dt>
                <dd class="font-semibold text-red-600">{{ docs.summary.missing }}</dd>
              </div>
            </dl>
          </div>
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
}>();

const { t } = useI18n();

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
