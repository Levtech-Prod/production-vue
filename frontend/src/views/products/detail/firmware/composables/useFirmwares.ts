import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { firmwaresApi } from '../../../../../api/firmwareAPI.ts';
import { useNotificationStore } from '../../../../../stores/notificationStore.ts';
import { useConfirmDelete } from '../../../../../composables/useConfirmDelete.ts';
import { translateApiError } from '../../../../../utils/apiError.ts';
import type { Firmware, FirmwareFile, FirmwarePayload } from '../../../../../types/firmware.ts';
import type { PanelScope } from '../../types.ts';

/** The firmware panel only exists for a sub-product revision. */
type FirmwareScope = Extract<PanelScope, { kind: 'spRev' }>;

function isFirmwareScope(scope: PanelScope | null): scope is FirmwareScope {
  return scope?.kind === 'spRev';
}

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

  const cache = new Map<string, Firmware[]>();
  const firmwares = ref<Firmware[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const uploading = ref(false);
  let token = 0;

  /** Which firmware the details pane is showing. */
  const selectedId = ref<number | null>(null);

  const selected = computed(
    () => firmwares.value.find((f) => f.id === selectedId.value) ?? null,
  );

  const productionFirmware = computed(
    () => firmwares.value.find((f) => f.status === 'production') ?? null,
  );

  function keyFor(scope: FirmwareScope): string {
    return `sp:${scope.spId}:${scope.revId}`;
  }

  /** Is this scope still the one on screen? */
  function isCurrent(scope: FirmwareScope): boolean {
    return isFirmwareScope(panelScope.value) && keyFor(panelScope.value) === keyFor(scope);
  }

  /** Keep the selection valid across refetches: hold it if the firmware is
   *  still there, otherwise fall back to the newest. */
  function applySelection(list: Firmware[]) {
    if (list.some((f) => f.id === selectedId.value)) return;
    selectedId.value = list[0]?.id ?? null;
  }

  /** Fetch one revision. Null when the request failed or was superseded — a
   *  slow response must never overwrite a later selection. The response is
   *  cached either way: it is valid data for the scope it was asked for. */
  async function fetchFirmwares(scope: FirmwareScope): Promise<Firmware[] | null> {
    const requestToken = ++token;
    try {
      const res = await firmwaresApi.getAll(scope.spId, scope.revId);
      cache.set(keyFor(scope), res.data.firmwares);
      return requestToken === token ? res.data.firmwares : null;
    } catch {
      // Drop any cached value: after a failed refresh it is stale, and
      // re-reading is cheaper than showing something wrong.
      cache.delete(keyFor(scope));
      return null;
    }
  }

  /** Show a revision's firmwares, from cache when possible. */
  async function load(scope: PanelScope) {
    if (!isFirmwareScope(scope)) return;

    const cached = cache.get(keyFor(scope));
    if (cached) {
      firmwares.value = cached;
      applySelection(cached);
      // A cache hit is not loading, and it may be resolving a scope switch
      // that happened while a slower load was still in flight.
      loading.value = false;
      return;
    }

    loading.value = true;
    try {
      const fresh = await fetchFirmwares(scope);
      if (isCurrent(scope)) {
        firmwares.value = fresh ?? [];
        applySelection(firmwares.value);
      }
    } finally {
      if (isCurrent(scope)) loading.value = false;
    }
  }

  /** Re-read the current revision after a mutation. */
  async function refresh(scope: FirmwareScope, selectId?: number) {
    const fresh = await fetchFirmwares(scope);
    if (!fresh || !isCurrent(scope)) return;
    firmwares.value = fresh;
    if (selectId != null) selectedId.value = selectId;
    applySelection(fresh);
  }

  function clearCache() {
    cache.clear();
    firmwares.value = [];
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

  /** Create when `target` is null, otherwise update it. Shared by the form and
   *  by the details pane's "set as production" shortcut. */
  async function persist(target: Firmware | null, payload: FirmwarePayload) {
    const scope = panelScope.value;
    if (!isFirmwareScope(scope) || saving.value) return;
    saving.value = true;
    try {
      const res = target
        ? await firmwaresApi.update(target.id, payload)
        : await firmwaresApi.create(scope.spId, scope.revId, payload);
      notify.showToast(t(target ? 'firmware_updated' : 'firmware_created'), 'success');
      await refresh(scope, res.data.id);
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
    if (await persist(target, payload)) {
      formOpen.value = false;
      editTarget.value = null;
    }
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
    const scope = panelScope.value;
    if (!isFirmwareScope(scope)) return false;
    try {
      await firmwaresApi.delete(firmware.id);
      if (selectedId.value === firmware.id) selectedId.value = null;
      notify.showToast(t('firmware_deleted'), 'success');
      await refresh(scope);
      return true;
    } catch (err) {
      notify.showToast(translateApiError(err, { t, te }, 'errors_delete_firmware_failed'), 'error');
      return false;
    }
  });

  // ── Files ─────────────────────────────────────────────────────────────────

  async function uploadFiles(files: File[]) {
    const scope = panelScope.value;
    const firmware = selected.value;
    if (!isFirmwareScope(scope) || !firmware || files.length === 0 || uploading.value) return;
    uploading.value = true;
    try {
      await firmwaresApi.uploadFiles(firmware.id, files);
      notify.showToast(t('firmware_files_uploaded'), 'success');
      await refresh(scope, firmware.id);
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
    const scope = panelScope.value;
    const firmware = selected.value;
    if (!isFirmwareScope(scope) || !firmware) return false;
    try {
      await firmwaresApi.deleteFile(file.id);
      notify.showToast(t('firmware_file_deleted'), 'success');
      await refresh(scope, firmware.id);
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
