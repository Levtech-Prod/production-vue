import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { documentTypesApiFor } from '../../../../../api/documentTypesAPI.ts';
import { useNotificationStore } from '../../../../../stores/notificationStore.ts';
import { useConfirmDelete } from '../../../../../composables/useConfirmDelete.ts';
import { translateApiError } from '../../../../../utils/apiError.ts';
import {
  documentTypeDraftFrom,
  documentTypeNameError,
  documentTypePayloadFrom,
  emptyDocumentTypeDraft,
} from '../../../../../utils/documentTypeDraft.ts';
import type { DocumentTypeGroup } from '../../../../../types/products.ts';
import type { DocumentTypeDraft } from '../../../../../types/documentTypes.ts';
import type { PanelScope } from '../../types.ts';

/** A card being deleted, held while its confirmation modal is open. */
interface PendingType {
  group: DocumentTypeGroup;
  scope: PanelScope;
}

/**
 * Document types owned by the product / sub-product on screen: add, edit and
 * delete, driven from the Documents panel's cards.
 *
 * Admin-only, and only for the entity's OWN cards — ones inherited from its
 * type belong to the settings page, which is where every product sharing that
 * type would see the change.
 *
 * Separate from `useDocuments` because it operates on the requirements rather
 * than on the files that satisfy them: different endpoints, different
 * permission, and the only thing the two share is that a change here means the
 * panel has to be re-read. That is what `onChanged` is for — the caller passes
 * the refresh, so this composable owns no cache of its own.
 */
export function useDocumentTypes(
  panelScope: ComputedRef<PanelScope | null>,
  onChanged: (scope: PanelScope) => Promise<void>,
) {
  const { t, te } = useI18n();
  const notify = useNotificationStore();

  const modalOpen = ref(false);
  const draft = ref<DocumentTypeDraft>(emptyDocumentTypeDraft());
  const saving = ref(false);
  const saveError = ref<string | null>(null);

  // Captured when the form opens, not read at save time: the user can change
  // the tree selection while the dialog is up, and the save belongs to the
  // entity they opened it from.
  const scope = ref<PanelScope | null>(null);

  /** Which family and entity the current scope's document types belong to. */
  function targetFor(target: PanelScope) {
    return target.kind === 'product'
      ? { api: documentTypesApiFor('product'), entityId: target.productId }
      : { api: documentTypesApiFor('sub-product'), entityId: target.spId };
  }

  /** `group` null opens the add form; otherwise it edits that card. */
  function openModal(group: DocumentTypeGroup | null) {
    const current = panelScope.value;
    if (!current) return;
    scope.value = current;
    draft.value = group ? documentTypeDraftFrom(group) : emptyDocumentTypeDraft();
    saveError.value = null;
    modalOpen.value = true;
  }

  async function confirmSave() {
    const target = scope.value;
    if (!target || saving.value) return;

    // The modal reports its own name error inline; anything reaching here has
    // already passed it, so a failure is a caller bug rather than user input.
    if (documentTypeNameError(draft.value, t)) return;

    const { api, entityId } = targetFor(target);
    saving.value = true;
    saveError.value = null;
    try {
      const payload = documentTypePayloadFrom(draft.value);
      if (draft.value.id == null) {
        await api.createForEntity(entityId, payload);
      } else {
        await api.update(draft.value.id, payload);
      }
      await onChanged(target);
      notify.showToast(
        t(draft.value.id == null ? 'success.save_document_type' : 'success.update_document_type'),
        'success',
      );
      modalOpen.value = false;
    } catch (err) {
      saveError.value = translateApiError(err, { t, te }, 'errors.save_document_type_failed');
    } finally {
      saving.value = false;
    }
  }

  const deleteConfirm = useConfirmDelete<PendingType>(async ({ group, scope: target }) => {
    try {
      const { api } = targetFor(target);
      const res = await api.remove(group.id);
      await onChanged(target);
      // Files are never destroyed — the FK demotes them to "Other documents".
      notify.showToast(
        res.data.filesMovedToOther > 0
          ? t('success.delete_document_type_with_files', { count: res.data.filesMovedToOther })
          : t('success.delete_document_type'),
        'success',
      );
      return true;
    } catch (err) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors.delete_document_type_failed'),
        'error',
      );
      return false;
    }
  });

  function openDeleteConfirm(group: DocumentTypeGroup) {
    if (!panelScope.value) return;
    deleteConfirm.open({ group, scope: panelScope.value });
  }

  return {
    modalOpen,
    draft,
    saving,
    saveError,
    openModal,
    confirmSave,

    deleteVisible: computed(() => deleteConfirm.target.value != null),
    deleteTarget: computed(() => deleteConfirm.target.value),
    deleteBusy: deleteConfirm.busy,
    openDeleteConfirm,
    confirmDelete: deleteConfirm.confirm,
    cancelDelete: deleteConfirm.cancel,
  };
}
