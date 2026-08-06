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
 * Documents tab: loads the grouped payload (cached per scope), and handles
 * upload / replace / delete against whichever card the user acted on.
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

  const docsCache = new Map<string, RevisionDocuments>();
  const docs = ref<RevisionDocuments>(EMPTY);
  const docsLoading = ref(false);
  const docsUploading = ref(false);
  let docsToken = 0;

  const docsTitle = computed(() => {
    const scope = panelScope.value;
    if (!scope || scope.kind === 'product') return t('product_documents');
    const { sp, rev } = spRevInfo(scope.spId, scope.revId);
    return t('sp_rev_documents', { name: sp?.name ?? '', label: rev?.label ?? '' });
  });

  /** Is this scope still the one on screen? */
  function isCurrent(scope: PanelScope): boolean {
    return panelScope.value != null && docsKeyFor(panelScope.value) === docsKeyFor(scope);
  }

  /** Fetch one scope. Null when the request failed or was superseded by a newer
   *  one — a slow response must never overwrite a later selection.
   *
   *  The response is cached either way: it is valid data for the scope it was
   *  asked for, whether or not that scope is still on screen, so switching back
   *  is instant instead of refetching. Only the *return* is suppressed. */
  async function fetchDocs(scope: PanelScope): Promise<RevisionDocuments | null> {
    const token = ++docsToken;
    const key = docsKeyFor(scope);
    try {
      const res = await documentsApiFor(scope).getAll(scope.revId);
      docsCache.set(key, res.data);
      return token === docsToken ? res.data : null;
    } catch {
      // Drop any cached value: after a failed refresh (post-mutation) it is
      // stale, and re-reading is cheaper than showing something wrong.
      docsCache.delete(key);
      return null;
    }
  }

  /** Show a scope, from cache when possible. */
  async function loadDocs(scope: PanelScope) {
    const cached = docsCache.get(docsKeyFor(scope));
    if (cached) {
      docs.value = cached;
      // A cache hit is not loading — and it may be resolving a scope switch
      // that happened while an earlier, slower load was still in flight. That
      // load will bail out below without touching the flag, so if this branch
      // did not clear it the spinner would cover perfectly good cached data.
      docsLoading.value = false;
      return;
    }

    docsLoading.value = true;
    try {
      const fresh = await fetchDocs(scope);
      // If the user moved on, leave the view to the newer call.
      if (isCurrent(scope)) docs.value = fresh ?? EMPTY;
    } finally {
      // Only the call whose scope is still on screen owns the flag; a
      // superseded one clearing it would hide the newer call's spinner.
      if (isCurrent(scope)) docsLoading.value = false;
    }
  }

  /** Re-read a scope after a mutation, updating the view if still on it. */
  async function refresh(scope: PanelScope) {
    const fresh = await fetchDocs(scope);
    if (fresh && isCurrent(scope)) docs.value = fresh;
  }

  /** Forget everything and show nothing — used when switching product. */
  function clearCache() {
    docsCache.clear();
    docs.value = EMPTY;
  }

  /** Drop one scope's cached documents (e.g. after its owning revision was
   *  deleted elsewhere), without disturbing other cached scopes. */
  function dropCacheKey(key: string) {
    docsCache.delete(key);
  }

  // ── Upload (name entry, then upload) ──────────────────────────────────────

  const docNameModalOpen = ref(false);
  const pendingDocFile = ref<File | null>(null);
  const pendingDocScope = ref<PanelScope | null>(null);
  const pendingDocTypeId = ref<number | null>(null);
  const pendingDocName = ref('');

  /** `documentTypeId` null means the file goes to "Other documents". */
  function onUploadFile(file: File, documentTypeId: number | null) {
    if (!panelScope.value) return;
    pendingDocFile.value = file;
    pendingDocScope.value = panelScope.value;
    pendingDocTypeId.value = documentTypeId;
    pendingDocName.value = ''; // empty → backend keeps the original file name
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
        pendingDocName.value.trim() || undefined,
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
    pendingDocName.value = '';
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

    docNameModalOpen,
    pendingDocFile,
    pendingDocName,
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
