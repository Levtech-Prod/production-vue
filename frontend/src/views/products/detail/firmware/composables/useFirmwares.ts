import { computed, ref, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { firmwaresApi } from '../../../../../api/firmwareAPI.ts';
import { useNotificationStore } from '../../../../../stores/notificationStore.ts';
import { useConfirmDelete } from '../../../../../composables/useConfirmDelete.ts';
import { useScopedCache } from '../../../../../composables/useScopedCache.ts';
import { translateApiError } from '../../../../../utils/apiError.ts';
import type { Firmware, FirmwareFile, FirmwarePayload } from '../../../../../types/firmware.ts';
import type { PanelScope } from '../../types.ts';

/** The firmware panel only exists for a sub-product revision. */
type FirmwareScope = Extract<PanelScope, { kind: 'spRev' }>;

function isFirmwareScope(scope: PanelScope | null): scope is FirmwareScope {
  return scope?.kind === 'spRev';
}

/** One shared instance: the cache hands it out for every scope with no data,
 *  and it is never mutated. */
const EMPTY: Firmware[] = [];

/**
 * Firmware tab: loads one revision's firmwares (cached per revision) and runs
 * the create / edit / delete and file mutations against it.
 *
 * Every mutation refetches the revision rather than patching the cached list —
 * promoting one firmware silently deprecates another, so re-deriving is both
 * simpler and impossible to get out of step.
 */
export function useFirmwares(panelScope: ComputedRef<PanelScope | null>) {
  const { t, te } = useI18n();
  const notify = useNotificationStore();

  const saving = ref(false);
  const uploading = ref(false);

  /** Which firmware the details pane is showing. */
  const selectedId = ref<number | null>(null);

  /** Narrowed for the cache: firmware only exists under a sub-product
   *  revision, so a product-scoped panel has nothing to load. */
  const scope = computed<FirmwareScope | null>(() =>
    isFirmwareScope(panelScope.value) ? panelScope.value : null,
  );

  /** Keep the selection valid across refetches: hold it if the firmware is
   *  still there, otherwise fall back to the newest. */
  function applySelection(list: Firmware[]) {
    if (list.some((f) => f.id === selectedId.value)) return;
    selectedId.value = list[0]?.id ?? null;
  }

  const {
    data: firmwares,
    loading,
    load,
    refresh: refreshScope,
    clearCache: clearScopeCache,
  } = useScopedCache<FirmwareScope, Firmware[]>({
    current: scope,
    keyFor: (s) => `sp:${s.spId}:${s.revId}`,
    fetcher: async (s) => (await firmwaresApi.getAll(s.spId, s.revId)).data.firmwares,
    empty: EMPTY,
    onData: applySelection,
  });

  const selected = computed(
    () => firmwares.value.find((f) => f.id === selectedId.value) ?? null,
  );

  const productionFirmware = computed(
    () => firmwares.value.find((f) => f.status === 'production') ?? null,
  );

  /** Re-read the current revision after a mutation, optionally selecting the
   *  firmware the mutation produced. */
  async function refresh(target: FirmwareScope, selectId?: number) {
    if (selectId != null) selectedId.value = selectId;
    await refreshScope(target);
  }

  function clearCache() {
    clearScopeCache();
    selectedId.value = null;
  }

  // ── Create / edit ─────────────────────────────────────────────────────────

  const formOpen = ref(false);
  /** null = creating; otherwise the firmware being edited. */
  const editTarget = ref<Firmware | null>(null);

  function openCreate() {
    editTarget.value = null;
    formOpen.value = true;
  }

  function openEdit(firmware: Firmware) {
    editTarget.value = firmware;
    formOpen.value = true;
  }

  // Cleared whenever the modal closes, cancel included, so a later "New
  // version" click cannot reuse a stale edit target.
  watch(formOpen, (open) => {
    if (!open) editTarget.value = null;
  });

  /** Create when `target` is null, otherwise update it. Shared by the form and
   *  by the details pane's "set as production" shortcut. */
  async function persist(target: Firmware | null, payload: FirmwarePayload) {
    const current = scope.value;
    if (!current || saving.value) return;
    saving.value = true;
    try {
      const res = target
        ? await firmwaresApi.update(target.id, payload)
        : await firmwaresApi.create(current.spId, current.revId, payload);
      notify.showToast(t(target ? 'firmware_updated' : 'firmware_created'), 'success');
      await refresh(current, res.data.id);
      return true;
    } catch (err) {
      notify.showToast(translateApiError(err, { t, te }, 'errors_save_firmware_failed'), 'error');
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function save(payload: FirmwarePayload) {
    const target = editTarget.value;
    if (await persist(target, payload)) formOpen.value = false;
  }

  /** Promote a firmware straight from the details pane. The server demotes
   *  whichever one currently holds the production slot on this revision. */
  async function setProduction(firmware: Firmware) {
    await persist(firmware, {
      name: firmware.name,
      releaseNotes: firmware.releaseNotes,
      status: 'production',
    });
  }

  // ── Delete a firmware ─────────────────────────────────────────────────────

  const deleteConfirm = useConfirmDelete<Firmware>(async (firmware) => {
    const current = scope.value;
    if (!current) return false;
    try {
      await firmwaresApi.delete(firmware.id);
      if (selectedId.value === firmware.id) selectedId.value = null;
      notify.showToast(t('firmware_deleted'), 'success');
      await refresh(current);
      return true;
    } catch (err) {
      notify.showToast(translateApiError(err, { t, te }, 'errors_delete_firmware_failed'), 'error');
      return false;
    }
  });

  // ── Files ─────────────────────────────────────────────────────────────────

  async function uploadFiles(files: File[]) {
    const current = scope.value;
    const firmware = selected.value;
    if (!current || !firmware || files.length === 0 || uploading.value) return;
    uploading.value = true;
    try {
      await firmwaresApi.uploadFiles(firmware.id, files);
      notify.showToast(t('firmware_files_uploaded'), 'success');
      await refresh(current, firmware.id);
    } catch (err) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors_upload_firmware_file_failed'),
        'error',
      );
    } finally {
      uploading.value = false;
    }
  }

  const fileDeleteConfirm = useConfirmDelete<FirmwareFile>(async (file) => {
    const current = scope.value;
    const firmware = selected.value;
    if (!current || !firmware) return false;
    try {
      await firmwaresApi.deleteFile(file.id);
      notify.showToast(t('firmware_file_deleted'), 'success');
      await refresh(current, firmware.id);
      return true;
    } catch (err) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors_delete_firmware_file_failed'),
        'error',
      );
      return false;
    }
  });

  return {
    firmwares,
    selected,
    selectedId,
    productionFirmware,
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

    uploadFiles,
    fileDeleteTarget: fileDeleteConfirm.target,
    fileDeleteBusy: fileDeleteConfirm.busy,
    openFileDeleteConfirm: fileDeleteConfirm.open,
    confirmFileDelete: fileDeleteConfirm.confirm,
    cancelFileDelete: fileDeleteConfirm.cancel,
  };
}
