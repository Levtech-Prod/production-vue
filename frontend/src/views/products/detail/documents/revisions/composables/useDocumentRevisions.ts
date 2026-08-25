import { computed, ref, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { documentRevisionsApi } from '../../../../../../api/documentRevisionsAPI.ts';
import { useNotificationStore } from '../../../../../../stores/notificationStore.ts';
import { useConfirmDelete } from '../../../../../../composables/useConfirmDelete.ts';
import { useScopedCache } from '../../../../../../composables/useScopedCache.ts';
import { translateApiError } from '../../../../../../utils/apiError.ts';
import type { DocumentTypeFamily } from '../../../../../../types/documentTypes.ts';
import type {
  DocumentRevision,
  DocumentRevisionFile,
  DocumentRevisionPayload,
} from '../../../../../../types/documentRevisions.ts';

/** Which card's versions the panel is showing. Not a `PanelScope`: versions
 *  belong to the product / sub-product, so the selected revision is irrelevant
 *  — only the family and the card matter. */
export interface RevisionCardScope {
  family: DocumentTypeFamily;
  documentTypeId: number;
}

/** One shared instance: the cache hands it out for every scope with no data,
 *  and it is never mutated. */
const EMPTY: DocumentRevision[] = [];

/**
 * The versions of one revision-mode document type: loads them (cached per
 * card) and runs the create / edit / delete and file mutations against it.
 *
 * Every mutation refetches the card rather than patching the cached list —
 * promoting one version silently deprecates another, so re-deriving is both
 * simpler and impossible to get out of step. `onChanged` re-reads the Documents
 * panel, whose cards carry the version count and the production version's name.
 */
export function useDocumentRevisions(
  cardScope: ComputedRef<RevisionCardScope | null>,
  onChanged: () => Promise<void>,
) {
  const { t, te } = useI18n();
  const notify = useNotificationStore();

  const saving = ref(false);
  const uploading = ref(false);

  /** Which version the details pane is showing. */
  const selectedId = ref<number | null>(null);

  /** Keep the selection valid across refetches: hold it if the version is still
   *  there, otherwise fall back to the newest. */
  function applySelection(list: DocumentRevision[]) {
    if (list.some((r) => r.id === selectedId.value)) return;
    selectedId.value = list[0]?.id ?? null;
  }

  const {
    data: revisions,
    loading,
    load,
    refresh: refreshScope,
    clearCache: clearScopeCache,
  } = useScopedCache<RevisionCardScope, DocumentRevision[]>({
    current: cardScope,
    keyFor: (s) => `${s.family}:${s.documentTypeId}`,
    fetcher: async (s) =>
      (await documentRevisionsApi.getAll(s.family, s.documentTypeId)).data.revisions,
    empty: EMPTY,
    onData: applySelection,
  });

  const selected = computed(() => revisions.value.find((r) => r.id === selectedId.value) ?? null);

  /** Re-read the current card after a mutation, optionally selecting the version
   *  the mutation produced, and refresh the panel behind it. */
  async function refresh(target: RevisionCardScope, selectId?: number) {
    if (selectId != null) selectedId.value = selectId;
    await Promise.all([refreshScope(target), onChanged()]);
  }

  function clearCache() {
    clearScopeCache();
    selectedId.value = null;
  }

  // ── Create / edit ─────────────────────────────────────────────────────────

  const formOpen = ref(false);
  /** null = creating; otherwise the version being edited. */
  const editTarget = ref<DocumentRevision | null>(null);

  function openCreate() {
    editTarget.value = null;
    formOpen.value = true;
  }

  function openEdit(revision: DocumentRevision) {
    editTarget.value = revision;
    formOpen.value = true;
  }

  // Cleared whenever the modal closes, cancel included, so a later "New version"
  // click cannot reuse a stale edit target.
  watch(formOpen, (open) => {
    if (!open) editTarget.value = null;
  });

  /** Create when `target` is null, otherwise update it. Shared by the form and
   *  by the details pane's "set as production" shortcut. */
  async function persist(target: DocumentRevision | null, payload: DocumentRevisionPayload) {
    const current = cardScope.value;
    if (!current || saving.value) return;
    saving.value = true;
    try {
      const res = target
        ? await documentRevisionsApi.update(target.id, payload)
        : await documentRevisionsApi.create(current.family, current.documentTypeId, payload);
      notify.showToast(t(target ? 'version_updated' : 'version_created'), 'success');
      await refresh(current, res.data.id);
      return true;
    } catch (err) {
      notify.showToast(translateApiError(err, { t, te }, 'errors_save_version_failed'), 'error');
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function save(payload: DocumentRevisionPayload) {
    const target = editTarget.value;
    if (await persist(target, payload)) formOpen.value = false;
  }

  /** Promote a version straight from the details pane. The server demotes
   *  whichever one currently holds the production slot on this card. */
  async function setProduction(revision: DocumentRevision) {
    await persist(revision, {
      name: revision.name,
      releaseNotes: revision.releaseNotes,
      status: 'production',
    });
  }

  // ── Delete a version ──────────────────────────────────────────────────────

  const deleteConfirm = useConfirmDelete<DocumentRevision>(async (revision) => {
    const current = cardScope.value;
    if (!current) return false;
    try {
      await documentRevisionsApi.delete(revision.id);
      if (selectedId.value === revision.id) selectedId.value = null;
      notify.showToast(t('version_deleted'), 'success');
      await refresh(current);
      return true;
    } catch (err) {
      notify.showToast(translateApiError(err, { t, te }, 'errors_delete_version_failed'), 'error');
      return false;
    }
  });

  // ── Files ─────────────────────────────────────────────────────────────────

  // Picked files are held here while the name modal is open, mirroring the
  // documents flow — the difference being that a version takes several at once,
  // so the names are a parallel array rather than a single field.
  const uploadModalOpen = ref(false);
  const pendingFiles = ref<File[]>([]);
  const pendingNames = ref<string[]>([]);

  function onUploadFiles(files: File[]) {
    if (!cardScope.value || !selected.value || files.length === 0) return;
    pendingFiles.value = files;
    pendingNames.value = files.map(() => ''); // empty -> keep the original name
    uploadModalOpen.value = true;
  }

  function closeUploadModal() {
    uploadModalOpen.value = false;
    pendingFiles.value = [];
    pendingNames.value = [];
  }

  async function confirmUpload() {
    const current = cardScope.value;
    const revision = selected.value;
    const files = pendingFiles.value;
    if (!current || !revision || files.length === 0 || uploading.value) return;
    uploading.value = true;
    try {
      await documentRevisionsApi.uploadFiles(revision.id, files, pendingNames.value);
      notify.showToast(t('version_files_uploaded'), 'success');
      closeUploadModal();
      await refresh(current, revision.id);
    } catch (err) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors_upload_version_file_failed'),
        'error',
      );
    } finally {
      uploading.value = false;
    }
  }

  const fileDeleteConfirm = useConfirmDelete<DocumentRevisionFile>(async (file) => {
    const current = cardScope.value;
    const revision = selected.value;
    if (!current || !revision) return false;
    try {
      await documentRevisionsApi.deleteFile(file.id);
      notify.showToast(t('version_file_deleted'), 'success');
      await refresh(current, revision.id);
      return true;
    } catch (err) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors_delete_version_file_failed'),
        'error',
      );
      return false;
    }
  });

  return {
    revisions,
    selected,
    selectedId,
    loading,
    saving,
    uploading,
    load,
    clearCache,

    formOpen,
    editTarget,
    openCreate,
    openEdit,
    save,
    setProduction,

    deleteTarget: deleteConfirm.target,
    deleteBusy: deleteConfirm.busy,
    openDeleteConfirm: deleteConfirm.open,
    confirmDelete: deleteConfirm.confirm,
    cancelDelete: deleteConfirm.cancel,

    onUploadFiles,
    uploadModalOpen,
    pendingFiles,
    pendingNames,
    confirmUpload,
    fileDeleteTarget: fileDeleteConfirm.target,
    fileDeleteBusy: fileDeleteConfirm.busy,
    openFileDeleteConfirm: fileDeleteConfirm.open,
    confirmFileDelete: fileDeleteConfirm.confirm,
    cancelFileDelete: fileDeleteConfirm.cancel,
  };
}
