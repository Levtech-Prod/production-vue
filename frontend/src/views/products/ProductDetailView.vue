<template>
  <div>
    <!-- Back link -->
    <RouterLink
      to="/products"
      class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
    >
      <ChevronLeft class="h-4 w-4" /> {{ t('products') }}
    </RouterLink>

    <div v-if="detail" class="mt-3">
      <ProductOverviewCard
        :detail="detail"
        :active-product-rev-id="activeProductRevId"
        :default-revision-label="defaultRevisionLabel"
        :is-archived="isArchived"
        @set-active-revision="setActiveRevision"
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
          :rev-panel-view="revPanelView"
          :membership-map="membershipMap"
          :composing-revision="composingRevision"
          :compose-selection="composeSelection"
          :is-archived="isArchived"
          :is-admin="isAdmin"
          :collapsed="treeCollapsed"
          @update:collapsed="treeCollapsed = $event"
          @update:rev-panel-view="revPanelView = $event"
          @select="onSelect"
          @toggle-revisions-mode="toggleRevisionsMode"
          @toggle-compose="toggleCompose"
          @new-sub-product="openNewSubProduct"
          @edit-sub-product="openEditSubProduct"
          @new-sp-revision="openNewSubProductRevision"
          @edit-sp-revision="openEditSpRevision"
          @delete-sp-revision="openDeleteRevConfirm"
          @delete-sub-product="openDeleteSubProductConfirm"
          @set-active-rev="setActiveRevision"
          @edit-product-rev="openEditProductRevision"
          @set-default-revision="onSetDefaultRevision"
          @start-new-revision="startNewRevision"
          @cancel-new-revision="cancelNewRevision"
          @save-composition="composeModalOpen = true"
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
            @select="onSelect"
            @edit-product-rev="openEditProductRevision"
            @edit-sp-revision="openEditSpRevision"
          />

          <DocumentsPanel
            v-else-if="activeTab === 'documents' && panelScope"
            :title="docsTitle"
            :docs="docs"
            :loading="docsLoading"
            :can-edit="!isArchived"
            :can-manage-types="isAdmin"
            @upload-file="onUploadFile"
            @replace-file="openDocReplaceConfirm"
            @delete-doc="openDocDeleteConfirm"
            @link-doc="openDocLinkModal"
            @add-type="openDocTypeModal(null)"
            @edit-type="openDocTypeModal"
            @delete-type="openDocTypeDeleteConfirm"
          />

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
              @update="onPartsUpdate"
            />
            <BomPanel
              v-else
              :mode="panelScope.kind === 'product' ? 'product' : 'subRev'"
              :bom="bom"
              :parts="parts"
              :loading="contentLoading"
              :header-chip="bomHeaderChip"
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
      :saving="modalSaving"
      @saved="onEditRevisionSaved"
    />
    <!-- Delete revision confirmation -->
    <ConfirmModal
      :visible="revToDelete != null"
      :title="t('delete_revision')"
      :message="`${t('confirmations.delete_revision_msg')}${revToDelete ? `: ${revToDelete.spName} · ${revToDelete.revLabel}` : ''}`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="revDeleting"
      @confirm="confirmDeleteRevision"
      @cancel="cancelDeleteRevConfirm"
    />
    <!-- Delete whole sub-product confirmation -->
    <ConfirmModal
      :visible="spToDelete != null"
      :title="t('delete_sub_product')"
      :message="`${t('confirmations.delete_sub_product_msg')}${spToDelete ? `: ${spToDelete.name}` : ''}`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="spDeleting"
      @confirm="confirmDeleteSubProduct"
      @cancel="cancelDeleteSubProductConfirm"
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
    <DocumentUploadModal
      v-model="docNameModalOpen"
      v-model:name="pendingDocName"
      :file="pendingDocFile"
      :uploading="docsUploading"
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

    <!-- Delete document confirmation -->
    <ConfirmModal
      :visible="docDeleteConfirmVisible"
      :title="t('delete_document')"
      :message="`${t('confirmations.delete_document_msg')}${docToDelete ? `: ${docToDelete.doc.originalName}` : ''}`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="docDeleting"
      @confirm="confirmDocDelete"
      @cancel="cancelDocDelete"
    />

    <!-- Add / edit a document type belonging to this product alone -->
    <DocumentTypeFormModal
      v-model="docTypeModalOpen"
      v-model:draft="docTypeDraft"
      :saving="docTypeSaving"
      :save-error="docTypeSaveError"
      @confirm="confirmDocTypeSave"
    />

    <!-- Delete document type confirmation — its files move to "Other
         documents", they are never deleted. -->
    <ConfirmModal
      :visible="docTypeDeleteVisible"
      :title="t('delete_document_type')"
      :message="`${t('confirmations.delete_document_type_msg')}${docTypeToDelete ? `: ${docTypeToDelete.group.name}` : ''}`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="docTypeDeleting"
      @confirm="confirmDocTypeDelete"
      @cancel="cancelDocTypeDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronLeft, FileText, Info, List, GitCompare } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import SubProductModal from './SubProductModal.vue';
import SubProductRevisionModal from './SubProductRevisionModal.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import ProductTree from './detail/ProductTree.vue';
import RevisionOverviewPanel from './detail/RevisionOverviewPanel.vue';
import DocumentsPanel from './detail/documents/DocumentsPanel.vue';
import BomPanel from './detail/bom/BomPanel.vue';
import ComparePanel from './detail/compare/ComparePanel.vue';
import EditRevisionModal from './detail/EditRevisionModal.vue';
import ComposeRevisionModal from './detail/ComposeRevisionModal.vue';
import PartsEditorPanel from './detail/PartsEditorPanel.vue';
import ProductOverviewCard from './detail/ProductOverviewCard.vue';
import ChangeLogModal from '../../components/ChangeLogModal.vue';
import DocumentUploadModal from './detail/documents/DocumentUploadModal.vue';
import DocumentLinkModal from './detail/documents/DocumentLinkModal.vue';
import DocumentTypeFormModal from './detail/documents/DocumentTypeFormModal.vue';
import { useRevisionSelection } from './detail/composables/useRevisionSelection.ts';
import { usePanelScope } from './detail/composables/usePanelScope.ts';
import { useDocuments } from './detail/documents/composables/useDocuments.ts';
import { useBomAndParts } from './detail/bom/composables/useBomAndParts.ts';
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
  revPanelView,
  composingRevision,
  composeSelection,
  membershipMap,
  revisionLabel,
  defaultRevisionLabel,
  setActiveRevision,
  onSelect,
  toggleRevisionsMode,
  startNewRevision,
  cancelNewRevision,
  toggleCompose,
  dropFromComposition,
  spRevInfo,
  applyDefaults,
  resetForProductChange,
} = useRevisionSelection(detail);

const treeCollapsed = ref(false);

type RightPanelTab = 'overview' | 'documents' | 'bom' | 'compare';
const activeTab = ref<RightPanelTab>('documents');

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
  pendingDocFile,
  pendingDocName,
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
  typeModalOpen: docTypeModalOpen,
  typeDraft: docTypeDraft,
  typeSaving: docTypeSaving,
  typeSaveError: docTypeSaveError,
  openTypeModal: openDocTypeModal,
  confirmTypeSave: confirmDocTypeSave,
  typeDeleteVisible: docTypeDeleteVisible,
  typeDeleteTarget: docTypeToDelete,
  typeDeleteBusy: docTypeDeleting,
  openTypeDeleteConfirm: openDocTypeDeleteConfirm,
  confirmTypeDelete: confirmDocTypeDelete,
  cancelTypeDelete: cancelDocTypeDelete,
} = useDocuments(panelScope, docsKeyFor, spRevInfo);

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

// Leaving Revisions mode takes the Overview tab with it — without this the
// active tab would point at a tab that is no longer rendered, leaving the
// panel blank.
watch(revisionsMode, (on) => {
  if (!on && activeTab.value === 'overview') activeTab.value = 'documents';
});

// Load BOM/parts whenever their scope changes (needs a real revision).
watch(panelScope, (scope) => {
  if (scope) void loadContent(scope);
});
// Load docs whenever the panel scope changes (e.g. selecting a different
// sub-product, or switching product revision — product documents are stored
// per product revision now, so each one has its own set).
watch(panelScope, (scope) => {
  if (scope) void loadDocs(scope);
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
    activeProductRevId.value = newRev.id;
    composingRevision.value = false;
    composeSelection.value = {};
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
  if (panelScope.value) void loadDocs(panelScope.value);
}

onMounted(loadAndApplyDefaults);

watch(productId, () => {
  resetForProductChange();
  clearDocsCache();
  clearContentCaches();
  bom.value = [];
  parts.value = [];
  activeTab.value = 'documents';
  loadAndApplyDefaults();
});
</script>
