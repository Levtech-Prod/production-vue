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
      />

      <!-- Main grid: structure tree + right panel -->
      <div
        class="mt-4 grid h-[75vh] items-stretch gap-4 transition-[grid-template-columns] duration-200"
        :class="treeCollapsed ? 'lg:grid-cols-[3.25rem_1fr]' : 'lg:grid-cols-[20rem_1fr]'"
      >
        <ProductTree
          :detail="detail"
          :active-product-rev-id="activeProductRevId"
          :selection="selection"
          :revisions-mode="revisionsMode"
          :composing-revision="composingRevision"
          :compose-selection="composeSelection"
          :is-archived="isArchived"
          :collapsed="treeCollapsed"
          @update:collapsed="treeCollapsed = $event"
          @select="onSelect"
          @toggle-revisions-mode="toggleRevisionsMode"
          @toggle-compose="toggleCompose"
          @new-sub-product="subProductModalOpen = true"
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

          <DocumentsPanel
            v-if="activeTab === 'documents' && panelScope"
            :title="docsTitle"
            :docs="docs"
            :loading="docsLoading"
            :uploading="docsUploading"
            :can-edit="!isArchived"
            :empty-text="
              panelScope.kind === 'product' ? t('no_product_documents') : t('no_sp_rev_documents')
            "
            @upload-file="onUploadFile"
            @delete-doc="openDocDeleteConfirm"
          />

          <!-- BOM tab: read-only BOM/parts view; in Revisions mode a selected
               sub-product revision becomes editable right here. -->
          <template v-else-if="activeTab === 'bom' && panelScope">
            <PartsEditorPanel
              v-if="revisionsMode && selection.type === 'subProduct'"
              :key="selection.spRevId"
              :sp-name="spRevInfo(selection.spId, selection.spRevId).sp?.name ?? ''"
              :rev-label="spRevInfo(selection.spId, selection.spRevId).rev?.label ?? ''"
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
    <SubProductModal
      v-if="detail"
      v-model="subProductModalOpen"
      :saving="modalSaving"
      :product-revisions="detail.revisions"
      :default-revision-id="activeProductRevId"
      @saved="onCreateSubProduct"
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

    <!-- Delete document confirmation -->
    <ConfirmModal
      :visible="docDeleteConfirmVisible"
      :title="t('delete_document')"
      :message="`${t('confirmations.delete_document_msg')}${docToDelete ? `: ${docToDelete.name}` : ''}`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="docDeleting"
      @confirm="confirmDocDelete"
      @cancel="cancelDocDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronLeft, FileText, List, GitCompare } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import SubProductModal from './SubProductModal.vue';
import SubProductRevisionModal from './SubProductRevisionModal.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import ProductTree from './detail/ProductTree.vue';
import DocumentsPanel from './detail/documents/DocumentsPanel.vue';
import BomPanel from './detail/bom/BomPanel.vue';
import ComparePanel from './detail/compare/ComparePanel.vue';
import EditRevisionModal from './detail/EditRevisionModal.vue';
import ComposeRevisionModal from './detail/ComposeRevisionModal.vue';
import PartsEditorPanel from './detail/PartsEditorPanel.vue';
import ProductOverviewCard from './detail/ProductOverviewCard.vue';
import DocumentUploadModal from './detail/documents/DocumentUploadModal.vue';
import { useRevisionSelection } from './detail/composables/useRevisionSelection.ts';
import { usePanelScope } from './detail/composables/usePanelScope.ts';
import { useDocuments } from './detail/documents/composables/useDocuments.ts';
import { useBomAndParts } from './detail/bom/composables/useBomAndParts.ts';
import { useConfirmDelete } from './detail/composables/useConfirmDelete.ts';
import { useProductsStore } from '../../stores/productsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { productsApi, subProductsApi, productRevisionsApi } from '../../api/productsAPI.ts';
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

const productId = computed(() => Number(route.params.id));
const detail = computed(() => store.detail);
const isArchived = computed(() => detail.value?.status === 'archived');

// ── Selection / revision-switching state ──────────────────────────────────────

const {
  activeProductRevId,
  selection,
  revisionsMode,
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

type RightPanelTab = 'documents' | 'bom' | 'compare';
const activeTab = ref<RightPanelTab>('documents');

const tabs = computed(() => [
  { key: 'documents' as RightPanelTab, labelKey: 'tab_documents', icon: FileText },
  { key: 'bom' as RightPanelTab, labelKey: 'tab_bom', icon: List },
  { key: 'compare' as RightPanelTab, labelKey: 'tab_compare', icon: GitCompare },
]);

// ── Documents / BOM / parts (scoped to the current selection) ────────────────

const { panelScope, docsKeyFor } = usePanelScope(selection, activeProductRevId);

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
  deleteVisible: docDeleteConfirmVisible,
  deleteTarget: docToDelete,
  deleteBusy: docDeleting,
  openDeleteConfirm: openDocDeleteConfirm,
  confirmDelete: confirmDocDelete,
  cancelDelete: cancelDocDelete,
} = useDocuments(productId, panelScope, docsKeyFor, spRevInfo);

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

// Load docs and BOM/parts in parallel whenever the scope changes.
watch(panelScope, (scope) => {
  if (scope) void Promise.all([loadDocs(scope), loadContent(scope)]);
});

// ── Set default revision ──────────────────────────────────────────────────────

async function onSetDefaultRevision() {
  if (activeProductRevId.value == null) return;
  try {
    await productsApi.setDefaultRevision(productId.value, activeProductRevId.value);
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

async function onSaveComposition(payload: { label: string; changeNotes: string | null }) {
  modalSaving.value = true;
  try {
    const res = await store.createRevision(productId.value, {
      label: payload.label,
      changeNotes: payload.changeNotes,
      duplicateFromId: null,
    });
    const newRev = res.data;
    await productRevisionsApi.setSubProducts(newRev.id, Object.values(composeSelection.value));
    notify.showToast(t('success.save_revision'), 'success');
    composeModalOpen.value = false;
    await reload();
    activeProductRevId.value = newRev.id;
    composingRevision.value = false;
    composeSelection.value = {};
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.save_revision_failed'), 'error');
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
    notify.showToast(translateApiError(err, { t, te }, 'errors.update_revision_failed'), 'error');
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
    dropDocsCacheKey(docsKeyFor({ kind: 'spRev', spId: target.spId, revId: target.revId }));
    compareRefresh.value++;
    if (selection.value.type === 'subProduct' && selection.value.spRevId === target.revId) {
      selection.value = { type: 'product' };
    }
    notify.showToast(t('revision_deleted'), 'success');
    cancelDeleteRevConfirm(); // close the modal right away, reload runs after
    await reload();
    dropFromComposition(target.spId, target.revId);
    return true;
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.delete_revision_failed'), 'error');
    return false;
  }
});

function openDeleteRevConfirm(sp: DetailSubProduct, rev: SubProductRevision) {
  openRevDeleteTarget({ spId: sp.id, revId: rev.id, spName: sp.name, revLabel: rev.label });
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
      dropDocsCacheKey(docsKeyFor({ kind: 'spRev', spId: target.spId, revId: rev.id }));
    }
    compareRefresh.value++;
    if (selection.value.type === 'subProduct' && selection.value.spId === target.spId) {
      selection.value = { type: 'product' };
    }
    dropFromComposition(target.spId);
    notify.showToast(t('sub_product_deleted'), 'success');
    cancelDeleteSubProductConfirm(); // close the modal right away, reload runs after
    await reload();
    return true;
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.delete_sub_product_failed'), 'error');
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

function openNewSubProductRevision(sp: DetailSubProduct) {
  activeSubProduct.value = sp;
  sprModalOpen.value = true;
}

async function reload() {
  await store.fetchDetail(productId.value);
  // Membership may have changed — cached BOMs could be stale.
  clearBomCache();
}

async function onCreateSubProduct(payload: SubProductPayload, addToRevisionId: number | null) {
  modalSaving.value = true;
  try {
    const res = await subProductsApi.create(productId.value, payload);
    const newRev = res.data.revisions?.[0];
    if (addToRevisionId && newRev) {
      const existing = Array.from(membershipMap.value.get(addToRevisionId) ?? []);
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
    notify.showToast(translateApiError(err, { t, te }, 'errors.save_sub_product_failed'), 'error');
  } finally {
    modalSaving.value = false;
  }
}

async function onCreateSubProductRevision(payload: NewSubProductRevisionPayload) {
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
      composeSelection.value = { ...composeSelection.value, [spId]: res.data.id };
    }
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.save_sub_product_revision_failed'),
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
}

onMounted(loadAndApplyDefaults);

watch(productId, () => {
  resetForProductChange();
  clearDocsCache();
  clearContentCaches();
  docs.value = [];
  bom.value = [];
  parts.value = [];
  activeTab.value = 'documents';
  loadAndApplyDefaults();
});
</script>
