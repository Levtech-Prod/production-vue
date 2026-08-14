import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { documentsApiFor } from '../../../../../api/productsAPI.ts';
import { useNotificationStore } from '../../../../../stores/notificationStore.ts';
import type {
  LinkableRevision,
  ProductDocument,
  RevisionDocuments,
} from '../../../../../types/products.ts';
import type { PanelScope } from '../../types.ts';
import { useConfirmDelete } from '../../../../../composables/useConfirmDelete.ts';
import { useScopedCache } from '../../../../../composables/useScopedCache.ts';

interface SpRevLookup {
  (spId: number, revId: number): { sp?: { name: string }; rev?: { label: string } };
}

/** A pending destructive action, held while its confirmation modal is open. */
interface PendingDoc {
  doc: ProductDocument;
  scope: PanelScope;
}

/** A replace waiting on confirmation — same as above plus the incoming file. */
interface PendingReplace extends PendingDoc {
  file: File;
}

const EMPTY: RevisionDocuments = {
  documentTypes: [],
  other: [],
  summary: { totalTypes: 0, uploaded: 0, missing: 0 },
};

/**
 * Documents tab: loads the grouped payload (cached per scope via
 * `useScopedCache`), and handles upload / replace / delete against whichever
 * card the user acted on.
 *
 * Every mutation refetches the scope rather than patching the cached tree by
 * hand — a single upload can flip a card's status and shift the summary, so
 * re-deriving is both simpler and impossible to get out of step.
 */
export function useDocuments(
  panelScope: ComputedRef<PanelScope | null>,
  docsKeyFor: (scope: PanelScope) => string,
  spRevInfo: SpRevLookup,
) {
  const { t } = useI18n();
  const notify = useNotificationStore();

  const docsUploading = ref(false);

  const {
    data: docs,
    loading: docsLoading,
    load: loadDocs,
    refresh,
    invalidateAndRefresh,
    clearCache,
    dropCacheKey,
  } = useScopedCache<PanelScope, RevisionDocuments>({
    current: panelScope,
    keyFor: docsKeyFor,
    fetcher: async (scope) => (await documentsApiFor(scope).getAll(scope.revId)).data,
    empty: EMPTY,
  });

  const docsTitle = computed(() => {
    const scope = panelScope.value;
    if (!scope || scope.kind === 'product') return t('product_documents');
    const { sp, rev } = spRevInfo(scope.spId, scope.revId);
    return t('sp_rev_documents', { name: sp?.name ?? '', label: rev?.label ?? '' });
  });

  // ── Upload (name entry, then upload) ──────────────────────────────────────

  const docNameModalOpen = ref(false);
  const pendingDocFile = ref<File | null>(null);
  const pendingDocScope = ref<PanelScope | null>(null);
  const pendingDocTypeId = ref<number | null>(null);
  /** Index-aligned with `pendingDocFiles`. An array of one, because the shared
   *  name modal handles multi-file uploads too. */
  const pendingDocNames = ref<string[]>([]);

  /** The pending file as the shared modal wants it — a list. */
  const pendingDocFiles = computed(() =>
    pendingDocFile.value ? [pendingDocFile.value] : [],
  );

  /** `documentTypeId` null means the file goes to "Other documents". */
  function onUploadFile(file: File, documentTypeId: number | null) {
    if (!panelScope.value) return;
    pendingDocFile.value = file;
    pendingDocScope.value = panelScope.value;
    pendingDocTypeId.value = documentTypeId;
    pendingDocNames.value = ['']; // empty → backend keeps the original file name
    docNameModalOpen.value = true;
  }

  async function confirmDocUpload() {
    const file = pendingDocFile.value;
    const scope = pendingDocScope.value;
    if (!file || !scope || docsUploading.value) return;
    docsUploading.value = true;
    try {
      await documentsApiFor(scope).upload(
        scope.revId,
        file,
        pendingDocNames.value[0]?.trim() || undefined,
        pendingDocTypeId.value,
      );
      await refresh(scope);
      notify.showToast(t('document_uploaded'), 'success');
      closeUploadModal();
    } catch (err) {
      notify.showToast(uploadErrorMessage(err), 'error');
    } finally {
      docsUploading.value = false;
    }
  }

  function closeUploadModal() {
    docNameModalOpen.value = false;
    pendingDocFile.value = null;
    pendingDocScope.value = null;
    pendingDocTypeId.value = null;
    pendingDocNames.value = [];
  }

  /** Turn the server's specific rejection codes into something actionable. */
  function uploadErrorMessage(err: unknown): string {
    const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
    if (code === 'DOCUMENT_EXTENSION_NOT_ALLOWED') return t('errors_document_extension_not_allowed');
    if (code === 'DOCUMENT_TOO_LARGE') return t('errors_document_too_large');
    if (code === 'DOCUMENT_TYPE_MISMATCH') return t('errors_document_type_mismatch');
    return t('errors_upload_document_failed');
  }

  // ── Replace (confirmation, then copy-on-write upload) ─────────────────────

  const replaceConfirm = useConfirmDelete<PendingReplace>(async ({ doc, scope, file }) => {
    try {
      await documentsApiFor(scope).replace(
        scope.revId,
        doc.id,
        file,
        undefined,
        doc.documentTypeId,
      );
      await refresh(scope);
      notify.showToast(t('document_replaced'), 'success');
      return true;
    } catch (err) {
      notify.showToast(uploadErrorMessage(err), 'error');
      return false;
    }
  });

  function openReplaceConfirm(doc: ProductDocument, file: File) {
    if (!panelScope.value) return;
    replaceConfirm.open({ doc, scope: panelScope.value, file });
  }

  // ── Link a file from another revision ─────────────────────────────────────
  //
  // Not confirmed: linking only adds a row, so it is as undoable as an upload.
  // Only destructive actions get a modal (plan §"Edits allowed").

  const linkModalOpen = ref(false);
  const linkCardName = ref('');
  const linkTypeId = ref<number | null>(null);
  const linkScope = ref<PanelScope | null>(null);
  const linkRevisions = ref<LinkableRevision[]>([]);
  const linkLoading = ref(false);
  const linkBusy = ref(false);

  /** `documentTypeId` null = the "Other documents" bucket. */
  async function openLinkModal(documentTypeId: number | null, cardName: string) {
    const scope = panelScope.value;
    if (!scope) return;
    linkScope.value = scope;
    linkTypeId.value = documentTypeId;
    linkCardName.value = cardName;
    linkRevisions.value = [];
    linkModalOpen.value = true;
    linkLoading.value = true;
    try {
      const res = await documentsApiFor(scope).linkable(scope.revId, documentTypeId);
      // Dropped if the modal closed meanwhile, so it can't fill a later card.
      if (linkModalOpen.value) linkRevisions.value = res.data.revisions;
    } catch {
      notify.showToast(t('errors_load_linkable_failed'), 'error');
      linkModalOpen.value = false;
    } finally {
      linkLoading.value = false;
    }
  }

  async function confirmLink(sourceDocumentId: number) {
    const scope = linkScope.value;
    if (!scope || linkBusy.value) return;
    linkBusy.value = true;
    try {
      await documentsApiFor(scope).link(scope.revId, sourceDocumentId, linkTypeId.value);
      await refresh(scope);
      notify.showToast(t('document_linked'), 'success');
      linkModalOpen.value = false;
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      notify.showToast(
        code === 'DOCUMENT_ALREADY_LINKED'
          ? t('errors_document_already_linked')
          : code === 'DOCUMENT_EXTENSION_NOT_ALLOWED'
            ? t('errors_document_extension_not_allowed')
            : t('errors_link_document_failed'),
        'error',
      );
    } finally {
      linkBusy.value = false;
    }
  }

  // ── Delete (with confirmation) ────────────────────────────────────────────

  const deleteConfirm = useConfirmDelete<PendingDoc>(async ({ doc, scope }) => {
    try {
      await documentsApiFor(scope).remove(scope.revId, doc.id);
      await refresh(scope);
      notify.showToast(t('document_deleted'), 'success');
      return true;
    } catch {
      notify.showToast(t('errors_delete_document_failed'), 'error');
      return false;
    }
  });

  function openDeleteConfirm(doc: ProductDocument) {
    if (!panelScope.value) return;
    deleteConfirm.open({ doc, scope: panelScope.value });
  }

  return {
    docs,
    docsLoading,
    docsUploading,
    docsTitle,
    loadDocs,
    clearCache,
    dropCacheKey,
    // For changes made outside this composable that invalidate more than the
    // revision on screen — see useDocumentTypes.
    invalidateAndRefresh,

    docNameModalOpen,
    pendingDocFile,
    pendingDocFiles,
    pendingDocNames,
    onUploadFile,
    confirmDocUpload,
    closeUploadModal,

    linkModalOpen,
    linkCardName,
    linkRevisions,
    linkLoading,
    linkBusy,
    openLinkModal,
    confirmLink,

    replaceVisible: computed(() => replaceConfirm.target.value != null),
    replaceTarget: computed(() => replaceConfirm.target.value),
    replaceBusy: replaceConfirm.busy,
    openReplaceConfirm,
    confirmReplace: replaceConfirm.confirm,
    cancelReplace: replaceConfirm.cancel,

    deleteVisible: computed(() => deleteConfirm.target.value != null),
    deleteTarget: computed(() => deleteConfirm.target.value),
    deleteBusy: deleteConfirm.busy,
    openDeleteConfirm,
    confirmDelete: deleteConfirm.confirm,
    cancelDelete: deleteConfirm.cancel,
  };
}
