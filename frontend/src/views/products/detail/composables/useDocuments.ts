import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { documentsApi } from '../../../../api/productsAPI.ts';
import { useNotificationStore } from '../../../../stores/notificationStore.ts';
import type { ProductDocument } from '../../../../types/products.ts';
import type { PanelScope } from '../types.ts';
import { useConfirmDelete } from './useConfirmDelete.ts';

interface SpRevLookup {
  (spId: number, revId: number): { sp?: { name: string }; rev?: { label: string } };
}

interface DocToDelete {
  id: number;
  name: string;
  scope: PanelScope;
}

/** Documents tab: loading (cached per scope), upload (with a name-entry
 *  step) and delete, all scoped to whatever the Documents/BOM panels are
 *  currently showing (see `usePanelScope`). */
export function useDocuments(
  productId: ComputedRef<number>,
  panelScope: ComputedRef<PanelScope | null>,
  docsKeyFor: (scope: PanelScope) => string,
  spRevInfo: SpRevLookup,
) {
  const { t } = useI18n();
  const notify = useNotificationStore();

  const docsCache = new Map<string, ProductDocument[]>();
  const docs = ref<ProductDocument[]>([]);
  const docsLoading = ref(false);
  const docsUploading = ref(false);
  let docsToken = 0;

  const docsTitle = computed(() => {
    const scope = panelScope.value;
    if (!scope || scope.kind === 'product') return t('product_documents');
    const { sp, rev } = spRevInfo(scope.spId, scope.revId);
    return t('sp_rev_documents', { name: sp?.name ?? '', label: rev?.label ?? '' });
  });

  async function loadDocs(scope: PanelScope) {
    const key = docsKeyFor(scope);
    const cached = docsCache.get(key);
    if (cached) {
      docs.value = cached;
      return;
    }
    const token = ++docsToken;
    docsLoading.value = true;
    try {
      const res =
        scope.kind === 'product'
          ? await documentsApi.getProductDocuments(productId.value)
          : await documentsApi.getSpRevisionDocuments(scope.spId, scope.revId);
      if (token !== docsToken) return;
      docsCache.set(key, res.data);
      docs.value = res.data;
    } catch {
      if (token === docsToken) docs.value = [];
    } finally {
      if (token === docsToken) docsLoading.value = false;
    }
  }

  function clearCache() {
    docsCache.clear();
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
  const pendingDocName = ref('');

  function onUploadFile(file: File) {
    if (!panelScope.value) return;
    pendingDocFile.value = file;
    pendingDocScope.value = panelScope.value;
    pendingDocName.value = ''; // empty → backend keeps the original file name
    docNameModalOpen.value = true;
  }

  async function confirmDocUpload() {
    const file = pendingDocFile.value;
    const scope = pendingDocScope.value;
    if (!file || !scope || docsUploading.value) return;
    const name = pendingDocName.value.trim() || undefined;
    docsUploading.value = true;
    try {
      const res =
        scope.kind === 'product'
          ? await documentsApi.uploadProductDocument(productId.value, file, name)
          : await documentsApi.uploadSpRevisionDocument(scope.spId, scope.revId, file, name);
      const key = docsKeyFor(scope);
      const updated = [res.data, ...(docsCache.get(key) ?? [])];
      docsCache.set(key, updated);
      if (panelScope.value && docsKeyFor(panelScope.value) === key) docs.value = updated;
      notify.showToast(t('document_uploaded'), 'success');
      docNameModalOpen.value = false;
      pendingDocFile.value = null;
      pendingDocScope.value = null;
      pendingDocName.value = '';
    } catch {
      notify.showToast(t('errors_upload_document_failed'), 'error');
    } finally {
      docsUploading.value = false;
    }
  }

  // ── Delete (with confirmation) ────────────────────────────────────────────

  const deleteConfirm = useConfirmDelete<DocToDelete>(async (d) => {
    try {
      if (d.scope.kind === 'product') {
        await documentsApi.deleteProductDocument(productId.value, d.id);
      } else {
        await documentsApi.deleteSpRevisionDocument(d.scope.spId, d.scope.revId, d.id);
      }
      const key = docsKeyFor(d.scope);
      const updated = (docsCache.get(key) ?? []).filter((doc) => doc.id !== d.id);
      docsCache.set(key, updated);
      if (panelScope.value && docsKeyFor(panelScope.value) === key) docs.value = updated;
      notify.showToast(t('document_deleted'), 'success');
      return true;
    } catch {
      notify.showToast(t('errors_delete_document_failed'), 'error');
      return false;
    }
  });

  function openDeleteConfirm(doc: ProductDocument) {
    if (!panelScope.value) return;
    deleteConfirm.open({ id: doc.id, name: doc.originalName, scope: panelScope.value });
  }

  const deleteTarget = computed(() => deleteConfirm.target.value);

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
    deleteVisible: computed(() => deleteConfirm.target.value != null),
    deleteTarget,
    deleteBusy: deleteConfirm.busy,
    openDeleteConfirm,
    confirmDelete: deleteConfirm.confirm,
    cancelDelete: deleteConfirm.cancel,
  };
}
