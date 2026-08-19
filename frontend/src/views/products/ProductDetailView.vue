<template>
  <div>
    <!-- Back link -->
    <div v-if="detail">
      <ProductOverviewCard
        :detail="detail"
        :active-product-rev-id="activeProductRevId"
        :default-revision-label="defaultRevisionLabel"
        :is-archived="isArchived"
        @set-active-revision="onSetActiveRevision"
        @show-history="historyOpen = true"
      />

      <!-- Main grid: structure tree + right panel -->
      <div
        class="mt-4 grid h-[75vh] items-stretch gap-4 transition-[grid-template-columns] duration-200"
        :class="
          treeCollapsed
            ? 'lg:grid-cols-[3.25rem_1fr]'
            : 'lg:grid-cols-[20rem_1fr]'
        "
      >
        <ProductTree
          :detail="detail"
          :active-product-rev-id="activeProductRevId"
          :selection="selection"
          :revisions-mode="revisionsMode"
          :membership-map="membershipMap"
          :composing-revision="composingRevision"
          :compose-target-rev-id="composeTargetRevId"
          :compose-selection="composeSelection"
          :compose-dirty="composeDirty"
          :is-archived="isArchived"
          :is-admin="isAdmin"
          :collapsed="treeCollapsed"
          @update:collapsed="treeCollapsed = $event"
          @select="onSelect"
          @toggle-revisions-mode="toggleRevisionsMode"
          @toggle-compose="toggleCompose"
          @new-sub-product="openNewSubProduct"
          @edit-sub-product="openEditSubProduct"
          @new-sp-revision="openNewSubProductRevision"
          @edit-sp-revision="openEditSpRevision"
          @delete-sp-revision="openDeleteRevConfirm"
          @delete-sub-product="openDeleteSubProductConfirm"
          @set-active-rev="onSetActiveRevision"
          @edit-product-rev="openEditProductRevision"
          @delete-product-rev="openDeleteProductRevConfirm"
          @set-default-revision="onSetDefaultRevision"
          @start-new-revision="startNewRevision"
          @start-edit-composition="startEditComposition"
          @cancel-composing="cancelComposing"
          @save-composition="onSaveCompositionClick"
        />

        <!-- ── Right side panel ─────────────────────────────────────────── -->
        <aside class="card flex h-full min-h-0 flex-col overflow-hidden">
          <!-- Tabs -->
          <div class="shrink-0 border-b border-slate-100 p-2">
            <div class="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                :class="
                  activeTab === tab.key
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                "
                @click="activeTab = tab.key"
              >
                <component :is="tab.icon" class="h-3.5 w-3.5" />
                {{ t(tab.labelKey) }}
              </button>
            </div>
          </div>

          <RevisionOverviewPanel
            v-if="activeTab === 'overview'"
            :detail="detail"
            :active-product-rev-id="activeProductRevId"
            :selection="selection"
            :membership-map="membershipMap"
            :docs-summary="docs.summary"
            :is-archived="isArchived"
            :is-admin="isAdmin"
            @select="onSelect"
            @edit-product-rev="openEditProductRevision"
            @delete-product-rev="openDeleteProductRevConfirm"
            @edit-sp-revision="openEditSpRevision"
          />

          <template v-if="activeTab === 'documents' && panelScope">
            <DocumentsPanel
              v-if="documentsView === 'documents'"
              :title="docsTitle"
              :docs="docs"
              :loading="docsLoading"
              :can-edit="!isArchived"
              :can-manage-types="isAdmin"
              :show-firmware="panelScope.kind === 'spRev'"
              :firmware-count="fw.firmwares.length"
              :production-firmware-name="fw.productionFirmware?.name ?? null"
              @upload-file="onUploadFile"
              @replace-file="openDocReplaceConfirm"
              @delete-doc="openDocDeleteConfirm"
              @link-doc="openDocLinkModal"
              @add-type="openDocTypeModal(null)"
              @edit-type="openDocTypeModal"
              @delete-type="openDocTypeDeleteConfirm"
              @open-firmware="documentsView = 'firmware'"
            />
            <FirmwarePanel
              v-else
              :key="firmwareScopeKey"
              :title="firmwareTitle"
              :revision-label="firmwareRevisionLabel"
              :firmwares="fw.firmwares"
              :selected="fw.selected"
              :selected-id="fw.selectedId"
              :loading="fw.loading"
              :saving="fw.saving"
              :uploading="fw.uploading"
              :can-edit="!isArchived"
              @back="documentsView = 'documents'"
              @select="fw.selectedId = $event"
              @create="fw.openCreate"
              @edit="fw.openEdit"
              @delete="fw.openDeleteConfirm"
              @set-production="fw.setProduction"
              @upload="fw.onUploadFiles"
              @delete-file="fw.openFileDeleteConfirm"
            />
          </template>

          <!-- BOM tab: read-only BOM/parts view; in Revisions mode a selected
               sub-product revision becomes editable right here. -->
          <div
            v-else-if="activeTab === 'bom' && detail.subProducts.length === 0"
            class="py-4 text-center text-sm text-slate-400"
          >
            {{ t('no_sub_products_for_bom') }}
          </div>
          <template v-else-if="activeTab === 'bom' && panelScope">
            <PartsEditorPanel
              v-if="revisionsMode && selection.type === 'subProduct'"
              :key="selection.spRevId"
              :sp-id="selection.spId"
              :rev-id="selection.spRevId"
              :sp-name="
                spRevInfo(selection.spId, selection.spRevId).sp?.name ?? ''
              "
              :rev-label="
                spRevInfo(selection.spId, selection.spRevId).rev?.label ?? ''
              "
              :parts="parts"
              :loading="contentLoading"
              :saving="partsSaving"
              :can-edit="!isArchived"
              :alt-parts="altParts"
              @update="onPartsUpdate"
            />
            <BomPanel
              v-else
              :mode="panelScope.kind === 'product' ? 'product' : 'subRev'"
              :product-name="detail.name"
              :sp-id="panelScope.kind === 'spRev' ? panelScope.spId : undefined"
              :rev-id="panelScope.kind === 'spRev' ? panelScope.revId : undefined"
              :bom="bom"
              :parts="parts"
              :loading="contentLoading"
              :header-chip="bomHeaderChip"
              :alt-parts="altParts"
              @select="
                onSelect({
                  type: 'subProduct',
                  spId: $event.spId,
                  spRevId: $event.spRevId,
                })
              "
            />
          </template>

          <!-- Compare tab stays mounted so the selection and cached
               results survive tab switches. -->
          <ComparePanel
            v-show="activeTab === 'compare'"
            :detail="detail"
            :initial-rev-id="activeProductRevId"
            :refresh-token="compareRefresh"
          />
        </aside>
      </div>
    </div>

    <div v-else class="py-16 text-center text-slate-400">
      {{ t('loading') }}
    </div>

    <!-- Modals -->
    <ChangeLogModal
      v-if="detail"
      v-model="historyOpen"
      entity-type="product"
      :entity-id="detail.id"
      :title="detail.name"
    />
    <SubProductModal
      v-if="detail"
      v-model="subProductModalOpen"
      :saving="modalSaving"
      :product-revisions="detail.revisions"
      :default-revision-id="activeProductRevId"
      :sub-product="spEditTarget"
      @saved="onSubProductSaved"
    />
    <SubProductRevisionModal
      v-model="sprModalOpen"
      :sub-product="activeSubProduct"
      :saving="modalSaving"
      @saved="onCreateSubProductRevision"
    />
    <EditRevisionModal
      v-model="editModalOpen"
      :revision="editTarget?.rev ?? null"
      :composition-hint="editTarget?.kind === 'productRev'"
      :saving="modalSaving"
      @saved="onEditRevisionSaved"
    />
    <DeleteConfirmModal
      :target="productRevToDelete"
      title-key="delete_product_revision"
      message-key="confirmations.delete_product_revision_msg"
      :label="(r) => r.label"
      :loading="productRevDeleting"
      @confirm="confirmDeleteProductRevision"
      @cancel="cancelDeleteProductRevConfirm"
    />
    <DeleteConfirmModal
      :target="revToDelete"
      title-key="delete_revision"
      message-key="confirmations.delete_revision_msg"
      :label="(r) => `${r.spName} · ${r.revLabel}`"
      :loading="revDeleting"
      @confirm="confirmDeleteRevision"
      @cancel="cancelDeleteRevConfirm"
    />
    <DeleteConfirmModal
      :target="spToDelete"
      title-key="delete_sub_product"
      message-key="confirmations.delete_sub_product_msg"
      :label="(sp) => sp.name"
      :loading="spDeleting"
      @confirm="confirmDeleteSubProduct"
      @cancel="cancelDeleteSubProductConfirm"
    />
    <!-- Saving an edited composition: the diff, before anything is written. -->
    <ConfirmModal
      :visible="compositionConfirmVisible"
      :title="t('confirm_revision_changes')"
      :message="compositionConfirmMessage"
      :confirm-text="t('save')"
      :cancel-text="t('cancel')"
      :loading="modalSaving"
      variant="primary"
      @confirm="saveCompositionChanges"
      @cancel="compositionConfirmVisible = false"
    />

    <!-- Switching revisions with unsaved compose checkboxes. -->
    <ConfirmModal
      :visible="pendingRevSwitchId != null"
      :title="t('discard_composition_changes')"
      :message="t('confirmations.discard_composition_changes_msg')"
      :confirm-text="t('discard')"
      :cancel-text="t('cancel')"
      @confirm="confirmRevSwitch"
      @cancel="pendingRevSwitchId = null"
    />

    <ComposeRevisionModal
      v-if="detail"
      v-model="composeModalOpen"
      :revisions="detail.revisions"
      :selected-count="Object.keys(composeSelection).length"
      :saving="modalSaving"
      @saved="onSaveComposition"
    />

    <!-- Document name entry (before upload) -->
    <FileNameModal
      v-model="docNameModalOpen"
      v-model:names="pendingDocNames"
      :files="pendingDocFiles"
      title-key="upload_document"
      :uploading="docsUploading"
      layer="nested"
      @confirm="confirmDocUpload"
    />

    <!-- Reuse a file from another revision: linked, not copied. -->
    <DocumentLinkModal
      v-model="docLinkModalOpen"
      :card-name="docLinkCardName"
      :revisions="docLinkRevisions"
      :loading="docLinkLoading"
      :busy="docLinking"
      @link="confirmDocLink"
    />

    <!-- Replace document confirmation — overwriting is destructive for this
         revision, so it is confirmed in any revision status. -->
    <ConfirmModal
      :visible="docReplaceConfirmVisible"
      :title="t('replace_document')"
      :message="
        docToReplace
          ? t('confirmations.replace_document_msg', {
              current: docToReplace.doc.originalName,
              incoming: docToReplace.file.name,
            })
          : ''
      "
      :confirm-text="t('replace')"
      :cancel-text="t('cancel')"
      :loading="docReplacing"
      @confirm="confirmDocReplace"
      @cancel="cancelDocReplace"
    />

    <DeleteConfirmModal
      :target="docToDelete"
      title-key="delete_document"
      message-key="confirmations.delete_document_msg"
      :label="(d) => d.doc.originalName"
      :loading="docDeleting"
      @confirm="confirmDocDelete"
      @cancel="cancelDocDelete"
    />

    <FileNameModal
      v-model="fw.uploadModalOpen"
      v-model:names="fw.pendingNames"
      :files="fw.pendingFiles"
      title-key="upload_file"
      :uploading="fw.uploading"
      @confirm="fw.confirmUpload"
    />

    <!-- Firmware version create / edit -->
    <FirmwareFormModal
      v-model="fw.formOpen"
      :firmware="fw.editTarget"
      :saving="fw.saving"
      @saved="fw.save"
    />

    <DeleteConfirmModal
      :target="fw.deleteTarget"
      title-key="delete_firmware"
      message-key="confirmations.delete_firmware_msg"
      :label="(f) => f.name"
      :loading="fw.deleteBusy"
      @confirm="fw.confirmDelete"
      @cancel="fw.cancelDelete"
    />

    <DeleteConfirmModal
      :target="fw.fileDeleteTarget"
      title-key="delete_firmware_file"
      message-key="confirmations.delete_firmware_file_msg"
      :label="(f) => f.originalName"
      :loading="fw.fileDeleteBusy"
      @confirm="fw.confirmFileDelete"
      @cancel="fw.cancelFileDelete"
    />

    <!-- Add / edit a document type belonging to this product alone -->
    <DocumentTypeFormModal
      v-model="docTypeModalOpen"
      v-model:draft="docTypeDraft"
      :saving="docTypeSaving"
      :save-error="docTypeSaveError"
      @confirm="confirmDocTypeSave"
    />

    <!-- Its files move to "Other documents", they are never deleted. -->
    <DeleteConfirmModal
      :target="docTypeToDelete"
      title-key="delete_document_type"
      message-key="confirmations.delete_document_type_msg"
      :label="(d) => d.group.name"
      :loading="docTypeDeleting"
      @confirm="confirmDocTypeDelete"
      @cancel="cancelDocTypeDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { FileText, Info, List, GitCompare } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import SubProductModal from './SubProductModal.vue';
import SubProductRevisionModal from './SubProductRevisionModal.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import DeleteConfirmModal from '../../components/notification/DeleteConfirmModal.vue';
import ProductTree from './detail/ProductTree.vue';
import RevisionOverviewPanel from './detail/RevisionOverviewPanel.vue';
import DocumentsPanel from './detail/documents/DocumentsPanel.vue';
import FirmwarePanel from './detail/firmware/FirmwarePanel.vue';
import FirmwareFormModal from './detail/firmware/FirmwareFormModal.vue';
import BomPanel from './detail/bom/BomPanel.vue';
import ComparePanel from './detail/compare/ComparePanel.vue';
import EditRevisionModal from './detail/EditRevisionModal.vue';
import ComposeRevisionModal from './detail/ComposeRevisionModal.vue';
import PartsEditorPanel from './detail/PartsEditorPanel.vue';
import ProductOverviewCard from './detail/ProductOverviewCard.vue';
import ChangeLogModal from '../../components/ChangeLogModal.vue';
import FileNameModal from '../../components/modal/FileNameModal.vue';
import DocumentLinkModal from './detail/documents/DocumentLinkModal.vue';
import DocumentTypeFormModal from './detail/documents/DocumentTypeFormModal.vue';
import { diffComposition } from './detail/revisionHelpers.ts';
import { useRevisionSelection } from './detail/composables/useRevisionSelection.ts';
import { usePanelScope } from './detail/composables/usePanelScope.ts';
import { useDocuments } from './detail/documents/composables/useDocuments.ts';
import { useDocumentTypes } from './detail/documents/composables/useDocumentTypes.ts';
import { useFirmwares } from './detail/firmware/composables/useFirmwares.ts';
import { useBomAndParts } from './detail/bom/composables/useBomAndParts.ts';
import { useAlternativeParts } from './detail/bom/composables/useAlternativeParts.ts';
import { useConfirmDelete } from '../../composables/useConfirmDelete.ts';
import { useProductsStore } from '../../stores/productsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { useAuthStore } from '../../stores/auth.ts';
import {
  productsApi,
  subProductsApi,
  productRevisionsApi,
} from '../../api/productsAPI.ts';
import { translateApiError } from '../../utils/apiError.ts';
import type {
  ProductRevision,
  DetailSubProduct,
  SubProductRevision,
  SubProductPayload,
  NewSubProductRevisionPayload,
} from '../../types/products.ts';
import type { EditRevisionPayload } from './detail/types.ts';

const { t, te } = useI18n();
const route = useRoute();
const store = useProductsStore();
const notify = useNotificationStore();
const authStore = useAuthStore();

const productId = computed(() => Number(route.params.id));
const detail = computed(() => store.detail);
const isArchived = computed(() => detail.value?.status === 'archived');

// Change log modal (opened from the overview card header).
const historyOpen = ref(false);
const isAdmin = computed(() => authStore.isAdmin);

// ── Selection / revision-switching state ──────────────────────────────────────

const {
  activeProductRevId,
  selection,
  revisionsMode,
  composingRevision,
  composeTargetRevId,
  composeSelection,
  composeBaseline,
  composeDirty,
  membershipMap,
  revisionLabel,
  defaultRevisionLabel,
  setActiveRevision,
  onSelect,
  toggleRevisionsMode,
  startNewRevision,
  startEditComposition,
  cancelComposing,
  stopComposing,
  toggleCompose,
  dropFromComposition,
  adoptSavedLink,
  spRevInfo,
  applyDefaults,
  resetForProductChange,
} = useRevisionSelection(detail);

const treeCollapsed = ref(false);

type RightPanelTab = 'overview' | 'documents' | 'bom' | 'compare';

const DEFAULT_TAB: RightPanelTab = 'bom';
const activeTab = ref<RightPanelTab>(DEFAULT_TAB);

// Overview describes the selected revision, so it only earns a tab while the
// left panel is showing revisions. Normal mode keeps the three tabs it had.
const tabs = computed(() => [
  ...(revisionsMode.value
    ? [{ key: 'overview' as RightPanelTab, labelKey: 'tab_overview', icon: Info }]
    : []),
  {
    key: 'documents' as RightPanelTab,
    labelKey: 'tab_documents',
    icon: FileText,
  },
  { key: 'bom' as RightPanelTab, labelKey: 'tab_bom', icon: List },
  {
    key: 'compare' as RightPanelTab,
    labelKey: 'tab_compare',
    icon: GitCompare,
  },
]);

// ── Documents / BOM / parts (scoped to the current selection) ────────────────

// The entity id comes from the loaded product, not the route param: it is
// null until the detail arrives, which is exactly when the panels have
// nothing to scope to anyway.
const { panelScope, docsKeyFor } = usePanelScope(
  selection,
  activeProductRevId,
  computed(() => detail.value?.id ?? null),
);

const {
  docs,
  docsLoading,
  docsUploading,
  docsTitle,
  loadDocs,
  clearCache: clearDocsCache,
  dropCacheKey: dropDocsCacheKey,
  docNameModalOpen,
  pendingDocFiles,
  pendingDocNames,
  onUploadFile,
  confirmDocUpload,
  linkModalOpen: docLinkModalOpen,
  linkCardName: docLinkCardName,
  linkRevisions: docLinkRevisions,
  linkLoading: docLinkLoading,
  linkBusy: docLinking,
  openLinkModal: openDocLinkModal,
  confirmLink: confirmDocLink,
  replaceVisible: docReplaceConfirmVisible,
  replaceTarget: docToReplace,
  replaceBusy: docReplacing,
  openReplaceConfirm: openDocReplaceConfirm,
  confirmReplace: confirmDocReplace,
  cancelReplace: cancelDocReplace,
  deleteVisible: docDeleteConfirmVisible,
  deleteTarget: docToDelete,
  deleteBusy: docDeleting,
  openDeleteConfirm: openDocDeleteConfirm,
  confirmDelete: confirmDocDelete,
  cancelDelete: cancelDocDelete,
  invalidateAndRefresh: refreshAllDocScopes,
} = useDocuments(panelScope, docsKeyFor, spRevInfo);

// Requirements rather than files: separate endpoints and admin-only, so it
// lives beside useDocuments rather than inside it. A change here invalidates
// every revision's cached panel, not just the one on screen.
const {
  modalOpen: docTypeModalOpen,
  draft: docTypeDraft,
  saving: docTypeSaving,
  saveError: docTypeSaveError,
  openModal: openDocTypeModal,
  confirmSave: confirmDocTypeSave,
  deleteVisible: docTypeDeleteVisible,
  deleteTarget: docTypeToDelete,
  deleteBusy: docTypeDeleting,
  openDeleteConfirm: openDocTypeDeleteConfirm,
  confirmDelete: confirmDocTypeDelete,
  cancelDelete: cancelDocTypeDelete,
} = useDocumentTypes(panelScope, refreshAllDocScopes);

// Firmware hangs off a sub-product revision, so it shares the Documents tab
// rather than earning one of its own: `documentsView` picks which of the two
// panels that tab shows.
const documentsView = ref<'documents' | 'firmware'>('documents');

// Kept as one namespace rather than destructured: every name would otherwise
// need a `firmware` prefix to avoid colliding with the document and revision
// equivalents (`selected`, `loading`, `saving`, `deleteTarget`…). `reactive`
// unwraps the refs, so the template reads `fw.selected`, `fw.loading`, and so
// on.
const fw = reactive(useFirmwares(panelScope));

// One lookup feeding all three: the panel's title, the revision label it
// shows, and the key that remounts it (so per-revision view state such as the
// change log's status filter does not follow you to the next revision).
const firmwareContext = computed(() => {
  const scope = panelScope.value;
  if (scope?.kind !== 'spRev') return null;
  const { sp, rev } = spRevInfo(scope.spId, scope.revId);
  return {
    key: `${scope.spId}:${scope.revId}`,
    label: rev?.label ?? '',
    name: sp?.name ?? '',
  };
});

const firmwareScopeKey = computed(() => firmwareContext.value?.key ?? '');
const firmwareRevisionLabel = computed(() => firmwareContext.value?.label ?? '');
const firmwareTitle = computed(() =>
  firmwareContext.value
    ? t('firmware_for', { name: firmwareContext.value.name, label: firmwareContext.value.label })
    : t('firmware'),
);

const {
  bom,
  parts,
  contentLoading,
  partsSaving,
  compareRefresh,
  bomHeaderChip,
  loadContent,
  onPartsUpdate,
  clearCaches: clearContentCaches,
  clearBomCache,
  dropRevision: dropPartsRevision,
} = useBomAndParts(selection, panelScope, spRevInfo, revisionLabel);

// Alternative-part links (see migration 021): shared across the BOM tab's
// views so the cache survives switching revisions/tabs, same reasoning as
// useBomAndParts above. reactive() (matching `fw` above) so `altParts.saving`
// unwraps to a plain boolean wherever it's read through the prop, instead of
// staying a Ref once it's nested inside this plain object.
const altParts = reactive(useAlternativeParts());

// Leaving Revisions mode takes the Overview tab with it — without this the
// active tab would point at a tab that is no longer rendered, leaving the
// panel blank.
watch(revisionsMode, (on) => {
  if (!on && activeTab.value === 'overview') activeTab.value = DEFAULT_TAB;
});

// Everything the right-hand panel shows is keyed on the same scope, so one
// watcher rather than one per resource: three effects on a single source meant
// three scheduler jobs and an ordering that was only implicit.
//
// Documents are per product REVISION, so switching revision is a scope change
// like any other. Firmware exists only under a sub-product revision — and is
// loaded even while the Documents view is showing, because the entry point
// there reports the version count and the current production version.
watch(panelScope, (scope) => {
  if (!scope) return;
  void loadContent(scope);
  void loadDocs(scope);
  if (scope.kind === 'spRev') {
    void fw.load(scope);
    void altParts.ensureLoaded(scope.spId, scope.revId);
  } else {
    // No firmware to show at product scope; fall back rather than render blank.
    documentsView.value = 'documents';
  }
});

// Product-level BOM lists parts across every linked sub-product revision, so
// its alternative links are batched in one request keyed by the product
// revision (see ensureLoadedForProductRevision) instead of looping
// ensureLoaded per sub-product — that would mean N requests on every product
// page load. Only fires for the flattened product-level view: `bom` is only
// populated when panelScope.kind === 'product' (see useBomAndParts).
watch(bom, (list) => {
  const scope = panelScope.value;
  if (list.length === 0 || scope?.kind !== 'product') return;
  void altParts.ensureLoadedForProductRevision(
    scope.revId,
    list.map((sp) => sp.subProductRevisionId),
  );
});

// ── Set default revision ──────────────────────────────────────────────────────

async function onSetDefaultRevision() {
  if (activeProductRevId.value == null) return;
  try {
    await productsApi.setDefaultRevision(
      productId.value,
      activeProductRevId.value,
    );
    notify.showToast(t('success.set_default_revision'), 'success');
    await reload();
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.set_default_revision_failed'),
      'error',
    );
  }
}

// ── Save composition as a new product revision ───────────────────────────────

const composeModalOpen = ref(false);
const modalSaving = ref(false);

const compositionConfirmVisible = ref(false);

// Composing a new revision needs a label and a document source, so it opens
// the compose modal; editing an existing one only needs a confirmation.
function onSaveCompositionClick() {
  if (composeTargetRevId.value == null) composeModalOpen.value = true;
  else compositionConfirmVisible.value = true;
}

const compositionChanges = computed(() =>
  diffComposition(
    detail.value?.subProducts ?? [],
    composeBaseline.value,
    composeSelection.value,
  ),
);

const compositionConfirmMessage = computed(() => {
  const lines = compositionChanges.value.map((c) =>
    c.kind === 'added'
      ? t('change_line_added', { name: c.name, to: c.to })
      : c.kind === 'removed'
        ? t('change_line_removed', { name: c.name, from: c.from })
        : t('change_line_changed', { name: c.name, from: c.from, to: c.to }),
  );
  return `${t('confirmations.save_composition_changes_msg')}\n\n${lines.join('\n')}`;
});

async function saveCompositionChanges() {
  const revId = composeTargetRevId.value;
  if (revId == null) return;
  modalSaving.value = true;
  try {
    const linkedIds = Object.values(composeSelection.value);
    await productRevisionsApi.setSubProducts(revId, linkedIds);
    // The membership changed: cached comparisons describe the old one, and the
    // selected sub-product revision may no longer be part of this revision.
    compareRefresh.value++;
    const linked = new Set(linkedIds);
    if (
      selection.value.type === 'subProduct' &&
      !linked.has(selection.value.spRevId)
    ) {
      selection.value = { type: 'product' };
    }
    notify.showToast(t('success.update_revision'), 'success');
    compositionConfirmVisible.value = false;
    stopComposing();
    await reload();
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.update_revision_failed'),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

// Switching revisions mid-compose would leave the checkboxes describing a
// revision that is no longer the one being edited — confirm first.
const pendingRevSwitchId = ref<number | null>(null);

function onSetActiveRevision(id: number) {
  if (composingRevision.value && composeDirty.value) {
    pendingRevSwitchId.value = id;
    return;
  }
  if (composingRevision.value) cancelComposing();
  setActiveRevision(id);
}

function confirmRevSwitch() {
  const id = pendingRevSwitchId.value;
  pendingRevSwitchId.value = null;
  if (id == null) return;
  cancelComposing();
  setActiveRevision(id);
}

async function onSaveComposition(payload: {
  label: string;
  changeNotes: string | null;
  documentsFromId: number | null;
}) {
  modalSaving.value = true;
  try {
    const res = await store.createRevision(productId.value, {
      label: payload.label,
      changeNotes: payload.changeNotes,
      // setSubProducts below sets the composition, so nothing to duplicate.
      duplicateFromId: null,
      // null = start with no documents.
      documentsFromId: payload.documentsFromId,
    });
    const newRev = res.data;
    await productRevisionsApi.setSubProducts(
      newRev.id,
      Object.values(composeSelection.value),
    );
    notify.showToast(t('success.save_revision'), 'success');
    composeModalOpen.value = false;
    await reload();
    stopComposing();
    activeProductRevId.value = newRev.id;
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.save_revision_failed'),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

// ── Edit revisions (product + sub-product) ───────────────────────────────────

type EditTarget =
  | { kind: 'productRev'; rev: ProductRevision }
  | { kind: 'spRev'; spId: number; rev: SubProductRevision };

const editModalOpen = ref(false);
const editTarget = ref<EditTarget | null>(null);

function openEditProductRevision(rev: ProductRevision) {
  editTarget.value = { kind: 'productRev', rev };
  editModalOpen.value = true;
}

function openEditSpRevision(sp: DetailSubProduct, rev: SubProductRevision) {
  editTarget.value = { kind: 'spRev', spId: sp.id, rev };
  editModalOpen.value = true;
}

async function onEditRevisionSaved(payload: EditRevisionPayload) {
  const target = editTarget.value;
  if (!target) return;
  modalSaving.value = true;
  try {
    if (target.kind === 'productRev') {
      await productRevisionsApi.update(target.rev.id, payload);
    } else {
      await subProductsApi.updateRevision(target.spId, target.rev.id, payload);
    }
    notify.showToast(t('success.update_revision'), 'success');
    editModalOpen.value = false;
    editTarget.value = null;
    await reload();
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.update_revision_failed'),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

// ── Delete a product revision (with confirmation) ───────────────────────────

const {
  target: productRevToDelete,
  busy: productRevDeleting,
  open: openProductRevDeleteTarget,
  confirm: confirmDeleteProductRevision,
  cancel: cancelDeleteProductRevConfirm,
} = useConfirmDelete<{ revId: number; label: string }>(async (target) => {
  try {
    await productRevisionsApi.delete(target.revId);
    dropDocsCacheKey(
      docsKeyFor({
        kind: 'product',
        productId: productId.value,
        revId: target.revId,
      }),
    );
    compareRefresh.value++;
    notify.showToast(t('revision_deleted'), 'success');
    cancelDeleteProductRevConfirm(); // close the modal right away, reload runs after
    // Nothing left to edit if its composition was the one open for editing.
    if (composeTargetRevId.value === target.revId) stopComposing();
    await reload();
    // The deleted revision may have been the active one — re-pick the default.
    // Not while composing: there the active revision is deliberately none.
    if (
      !composingRevision.value &&
      !detail.value?.revisions.some((r) => r.id === activeProductRevId.value)
    ) {
      applyDefaults();
    }
    return true;
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.delete_revision_failed'),
      'error',
    );
    return false;
  }
});

function openDeleteProductRevConfirm(rev: ProductRevision) {
  openProductRevDeleteTarget({ revId: rev.id, label: rev.label });
}

// ── Delete a sub-product revision (with confirmation) ───────────────────────

interface RevToDelete {
  spId: number;
  revId: number;
  spName: string;
  revLabel: string;
}

const {
  target: revToDelete,
  busy: revDeleting,
  open: openRevDeleteTarget,
  confirm: confirmDeleteRevision,
  cancel: cancelDeleteRevConfirm,
} = useConfirmDelete<RevToDelete>(async (target) => {
  try {
    await subProductsApi.deleteRevision(target.spId, target.revId);
    dropPartsRevision(target.revId);
    dropDocsCacheKey(
      docsKeyFor({ kind: 'spRev', spId: target.spId, revId: target.revId }),
    );
    compareRefresh.value++;
    if (
      selection.value.type === 'subProduct' &&
      selection.value.spRevId === target.revId
    ) {
      selection.value = { type: 'product' };
    }
    notify.showToast(t('revision_deleted'), 'success');
    cancelDeleteRevConfirm(); // close the modal right away, reload runs after
    await reload();
    dropFromComposition(target.spId, target.revId);
    return true;
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.delete_revision_failed'),
      'error',
    );
    return false;
  }
});

function openDeleteRevConfirm(sp: DetailSubProduct, rev: SubProductRevision) {
  openRevDeleteTarget({
    spId: sp.id,
    revId: rev.id,
    spName: sp.name,
    revLabel: rev.label,
  });
}

// ── Delete a whole sub-product (with confirmation) ───────────────────────────

const {
  target: spToDelete,
  busy: spDeleting,
  open: openSpDeleteTarget,
  confirm: confirmDeleteSubProduct,
  cancel: cancelDeleteSubProductConfirm,
} = useConfirmDelete<{ spId: number; name: string }>(async (target) => {
  try {
    await subProductsApi.delete(target.spId);
    const sp = detail.value?.subProducts.find((s) => s.id === target.spId);
    for (const rev of sp?.revisions ?? []) {
      dropPartsRevision(rev.id);
      dropDocsCacheKey(
        docsKeyFor({ kind: 'spRev', spId: target.spId, revId: rev.id }),
      );
    }
    compareRefresh.value++;
    if (
      selection.value.type === 'subProduct' &&
      selection.value.spId === target.spId
    ) {
      selection.value = { type: 'product' };
    }
    dropFromComposition(target.spId);
    notify.showToast(t('sub_product_deleted'), 'success');
    cancelDeleteSubProductConfirm(); // close the modal right away, reload runs after
    await reload();
    return true;
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.delete_sub_product_failed'),
      'error',
    );
    return false;
  }
});

function openDeleteSubProductConfirm(sp: DetailSubProduct) {
  openSpDeleteTarget({ spId: sp.id, name: sp.name });
}

// ── Modals: revisions / sub-products ─────────────────────────────────────────

const subProductModalOpen = ref(false);
const sprModalOpen = ref(false);
const activeSubProduct = ref<DetailSubProduct | null>(null);

// Sub-product general-info create/edit — set before opening the modal;
// its presence tells SubProductModal (and the save handler) whether this is
// a create or an edit. Cleared whenever the modal closes so a later "New
// sub-product" click can't accidentally reuse a stale edit target.
const spEditTarget = ref<DetailSubProduct | null>(null);

watch(subProductModalOpen, (isOpen) => {
  if (!isOpen) spEditTarget.value = null;
});

function openNewSubProduct() {
  spEditTarget.value = null;
  subProductModalOpen.value = true;
}

function openEditSubProduct(sp: DetailSubProduct) {
  spEditTarget.value = sp;
  subProductModalOpen.value = true;
}

function openNewSubProductRevision(sp: DetailSubProduct) {
  activeSubProduct.value = sp;
  sprModalOpen.value = true;
}

async function reload() {
  await store.fetchDetail(productId.value);
  // Membership may have changed — cached BOMs could be stale.
  clearBomCache();
}

async function onSubProductSaved(
  payload: SubProductPayload,
  addToRevisionId: number | null,
) {
  modalSaving.value = true;
  try {
    if (spEditTarget.value) {
      // Edit mode: general-info-only update, no revision/parts changes.
      await subProductsApi.update(spEditTarget.value.id, payload);
      notify.showToast(t('success.save_sub_product'), 'success');
      subProductModalOpen.value = false;
      await reload();
      return;
    }

    const res = await subProductsApi.create(productId.value, payload);
    const newRev = res.data.revisions?.[0];
    if (addToRevisionId && newRev) {
      const existing = Array.from(
        membershipMap.value.get(addToRevisionId) ?? [],
      );
      await productRevisionsApi.setSubProducts(
        addToRevisionId,
        Array.from(new Set([...existing, newRev.id])),
      );
      // Added straight into the revision whose composition is open for
      // editing: adopt the link so saving that composition can't undo it.
      if (addToRevisionId === composeTargetRevId.value) {
        adoptSavedLink(res.data.id, newRev.id);
      }
      notify.showToast(t('success.save_sub_product'), 'success');
      subProductModalOpen.value = false;
      await reload();
    } else {
      notify.showToast(t('success.save_sub_product'), 'success');
      subProductModalOpen.value = false;
      notify.showToast(t('sub_product_created_hint'), 'info');
      await reload();
    }
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.save_sub_product_failed'),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

async function onCreateSubProductRevision(
  payload: NewSubProductRevisionPayload,
) {
  if (!activeSubProduct.value) return;
  const spId = activeSubProduct.value.id;
  modalSaving.value = true;
  try {
    const res = await subProductsApi.createRevision(spId, payload);
    notify.showToast(t('success.save_sub_product_revision'), 'success');
    sprModalOpen.value = false;
    await reload();
    // While actively composing a new revision, the fresh revision is what
    // the user most likely wants in it — check it right away.
    if (composingRevision.value && res.data?.id != null) {
      composeSelection.value = {
        ...composeSelection.value,
        [spId]: res.data.id,
      };
    }
  } catch (err: any) {
    notify.showToast(
      translateApiError(
        err,
        { t, te },
        'errors.save_sub_product_revision_failed',
      ),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function loadAndApplyDefaults() {
  await reload();
  applyDefaults();
  // Explicit (rather than relying solely on the panelScope watcher above):
  // switching between two products whose active revision happens to be the
  // same object leaves the scope value unchanged, so the watcher wouldn't fire.
  const scope = panelScope.value;
  if (scope) {
    void loadDocs(scope);
    if (scope.kind === 'spRev') void fw.load(scope);
  }
}

onMounted(loadAndApplyDefaults);

watch(productId, () => {
  resetForProductChange();
  clearDocsCache();
  fw.clearCache();
  clearContentCaches();
  bom.value = [];
  parts.value = [];
  activeTab.value = DEFAULT_TAB;
  documentsView.value = 'documents';
  loadAndApplyDefaults();
});
</script>
