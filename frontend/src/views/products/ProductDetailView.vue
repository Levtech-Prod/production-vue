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
      <!-- Info bar -->
      <div class="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <img
          v-if="detail.image"
          :src="detail.image"
          class="h-20 w-20 rounded-xl border border-slate-200 object-cover"
          :alt="detail.name"
        />
        <div
          v-else
          class="grid h-20 w-20 place-items-center rounded-xl border border-slate-200 bg-slate-100 text-2xl text-slate-300"
        >
          ▣
        </div>

        <div class="flex-1">
          <h1 class="text-2xl font-bold">{{ detail.name }}</h1>
          <div class="font-mono text-sm text-slate-500">{{ detail.sku }}</div>
        </div>

        <div class="grid grid-cols-3 gap-4">
          <div>
            <div class="text-xs uppercase text-slate-400">{{ t('type') }}</div>
            <div class="font-semibold">{{ detail.type || '—' }}</div>
          </div>
          <div>
            <div class="text-xs uppercase text-slate-400">{{ t('revisions') }}</div>
            <div class="font-semibold">{{ detail.revisions.length }}</div>
          </div>
          <div>
            <div class="text-xs uppercase text-slate-400">{{ t('sub_products') }}</div>
            <div class="font-semibold">{{ detail.subProducts.length }}</div>
          </div>
        </div>
      </div>

      <!-- Revision selector -->
      <div class="mt-6 flex flex-wrap items-center gap-2">
        <span class="mr-1 text-sm font-medium text-slate-500">{{ t('revisions') }}:</span>
        <button
          v-for="(rev, i) in detail.revisions"
          :key="rev.id"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors"
          :class="pillClass(rev.id)"
          @click="toggleRevision(rev.id)"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="pillDot(rev.id, i)" />
          {{ rev.label }}
        </button>

        <button
          type="button"
          class="ml-1 inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600"
          @click="revisionModalOpen = true"
        >
          <Plus class="h-3.5 w-3.5" /> {{ t('new_revision') }}
        </button>

        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="btn-secondary !py-1.5 !text-xs"
            @click="subProductModalOpen = true"
          >
            {{ t('new_sub_product') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="selectedRevisionIds.length !== 1"
            :title="selectedRevisionIds.length !== 1 ? t('select_one_revision_hint') : ''"
            @click="addModalOpen = true"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('add_sub_product') }}
          </button>
        </div>
      </div>

      <p v-if="selectedRevisionIds.length === 2" class="mt-2 text-sm text-blue-600">
        {{ t('two_revisions_selected_hint') }}
      </p>

      <!-- Main grid: sub-product table + side panel -->
      <div class="mt-4 grid gap-4" :class="panelOpen ? 'lg:grid-cols-[22rem_1fr]' : ''">
        <!-- Sub-product table -->
        <div class="card overflow-hidden">
          <div class="border-b border-slate-100 px-4 py-3">
            <h2 class="font-semibold text-slate-700">{{ t('sub_products') }}</h2>
          </div>

          <div
            v-if="detail.subProducts.length === 0"
            class="py-10 text-center text-sm text-slate-400"
          >
            {{ t('no_sub_products_in_product') }}
          </div>

          <ul v-else class="divide-y divide-slate-100">
            <li
              v-for="sp in detail.subProducts"
              :key="sp.id"
              class="px-4 py-3 transition-opacity"
              :class="{ 'opacity-40': isSpDimmed(sp) }"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate font-semibold text-slate-800">{{ sp.name }}</div>
                  <div class="truncate font-mono text-xs text-slate-400">{{ sp.sku }}</div>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                  :title="t('new_revision')"
                  @click="openNewSubProductRevision(sp)"
                >
                  <Plus class="h-4 w-4" />
                </button>
              </div>

              <div class="mt-2 flex flex-col gap-1.5">
                <button
                  v-for="rev in sp.revisions"
                  :key="rev.id"
                  type="button"
                  class="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors"
                  :class="rowClass(sp, rev.id)"
                  @click="openParts(sp, rev.id, rev.label)"
                >
                  <span class="flex items-center gap-2 truncate">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="statusDot(rev.status)" />
                    <span class="truncate">{{ rev.label }}</span>
                  </span>
                  <span class="shrink-0 text-xs text-slate-400">{{ t('view_parts') }}</span>
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- Side panel: parts (single) / compare summary -->
        <aside v-if="panelOpen" class="card flex max-h-[70vh] flex-col overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 class="font-semibold text-slate-700">
              {{ compareMode ? t('comparison') : t('parts') }}
            </h3>
            <button
              type="button"
              class="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              @click="closePanel"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- Compare summary (2 product revisions selected) -->
          <div v-if="compareMode" class="flex-1 overflow-y-auto p-4">
            <div v-if="compareLoading" class="py-6 text-center text-sm text-slate-400">
              {{ t('loading') }}
            </div>
            <ul v-else-if="compareResult" class="flex flex-col gap-2">
              <li
                v-for="row in compareResult.subProducts"
                :key="row.subProductId"
                class="rounded-lg border px-3 py-2 text-sm"
                :class="compareRowClass(row.status)"
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium">{{ row.name }}</span>
                  <span class="text-xs uppercase">{{ t('compare_status.' + row.status) }}</span>
                </div>
                <div class="mt-1 flex gap-3 text-xs text-slate-500">
                  <span>A: {{ row.inA ? row.inA.revisionLabel : '—' }}</span>
                  <span>B: {{ row.inB ? row.inB.revisionLabel : '—' }}</span>
                </div>
              </li>
            </ul>
          </div>

          <!-- Single revision parts list -->
          <div v-else class="flex-1 overflow-y-auto p-4">
            <div class="mb-3">
              <div class="font-medium text-slate-800">{{ openPartsRef?.spName }}</div>
              <div class="text-xs text-slate-400">{{ openPartsRef?.revLabel }}</div>
            </div>
            <div v-if="partsLoading" class="py-6 text-center text-sm text-slate-400">
              {{ t('loading') }}
            </div>
            <div v-else-if="parts.length === 0" class="py-6 text-center text-sm text-slate-400">
              {{ t('no_parts_in_revision') }}
            </div>
            <ul v-else class="flex flex-col divide-y divide-slate-100">
              <li v-for="part in parts" :key="part.id" class="flex items-center justify-between py-2">
                <div>
                  <div class="text-sm font-medium text-slate-800">{{ part.name }}</div>
                  <div class="font-mono text-xs text-slate-400">{{ part.code }}</div>
                </div>
                <div class="text-right text-sm">
                  <span class="font-semibold">{{ part.quantity }}</span>
                  <span class="text-slate-400"> {{ part.unit || '' }}</span>
                </div>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>

    <div v-else class="py-16 text-center text-slate-400">{{ t('loading') }}</div>

    <!-- Modals -->
    <RevisionModal
      v-if="detail"
      v-model="revisionModalOpen"
      :revisions="detail.revisions"
      :saving="modalSaving"
      @saved="onCreateRevision"
    />
    <SubProductModal
      v-if="detail"
      v-model="subProductModalOpen"
      :saving="modalSaving"
      :product-revisions="detail.revisions"
      :default-revision-id="selectedRevisionIds[0] ?? null"
      @saved="onCreateSubProduct"
    />
    <AddSubProductModal
      v-model="addModalOpen"
      :already-linked-ids="linkedIdsForSelectedRevision"
      :linked-sub-product-ids="linkedSubProductIdsForSelectedRevision"
      :saving="modalSaving"
      @add="onAddSubProducts"
    />
    <SubProductRevisionModal
      v-model="sprModalOpen"
      :sub-product="activeSubProduct"
      :saving="modalSaving"
      @saved="onCreateSubProductRevision"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronLeft, Plus, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import RevisionModal from './RevisionModal.vue';
import SubProductModal from './SubProductModal.vue';
import AddSubProductModal from './AddSubProductModal.vue';
import SubProductRevisionModal from './SubProductRevisionModal.vue';
import { useProductsStore } from '../../stores/productsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { subProductsApi, productRevisionsApi } from '../../api/productsAPI.ts';
import { translateApiError } from '../../utils/apiError.ts';
import type {
  DetailSubProduct,
  RevisionPart,
  CompareResult,
  RevisionStatus,
  NewRevisionPayload,
  SubProductPayload,
  NewSubProductRevisionPayload,
} from '../../types/products.ts';

const { t, te } = useI18n();
const route = useRoute();
const store = useProductsStore();
const notify = useNotificationStore();

const productId = computed(() => Number(route.params.id));
const detail = computed(() => store.detail);

// ---- Revision selection (max 2) ----
const selectedRevisionIds = ref<number[]>([]);

function toggleRevision(id: number) {
  const idx = selectedRevisionIds.value.indexOf(id);
  if (idx !== -1) {
    selectedRevisionIds.value.splice(idx, 1);
  } else if (selectedRevisionIds.value.length < 2) {
    selectedRevisionIds.value.push(id);
  } else {
    // Replace the oldest selection.
    selectedRevisionIds.value = [selectedRevisionIds.value[1], id];
  }
}

// productRevisionId -> subProductRevisionId[]
const membership = computed<Record<number, number[]>>(() => {
  const map: Record<number, number[]> = {};
  for (const m of detail.value?.membership ?? []) {
    (map[m.productRevisionId] ??= []).push(m.subProductRevisionId);
  }
  return map;
});

// The set of sub_product_revision_ids in each currently selected product rev.
function selectedSetFor(index: number): Set<number> {
  const revId = selectedRevisionIds.value[index];
  return new Set(revId != null ? membership.value[revId] ?? [] : []);
}

const setA = computed(() => selectedSetFor(0));
const setB = computed(() => selectedSetFor(1));

function isSpDimmed(sp: DetailSubProduct): boolean {
  if (selectedRevisionIds.value.length === 0) return false;
  return !sp.revisions.some((r) => setA.value.has(r.id) || setB.value.has(r.id));
}

// Colour a revision row by which selected product revision(s) contain it.
function rowClass(_sp: DetailSubProduct, spRevId: number): string {
  const inA = setA.value.has(spRevId);
  const inB = setB.value.has(spRevId);
  const isOpen = openPartsRef.value?.revId === spRevId;
  if (isOpen) return 'border-blue-500 bg-blue-50 ring-1 ring-blue-300';
  if (inA && inB) return 'border-violet-300 bg-violet-50';
  if (inA) return 'border-blue-300 bg-blue-50';
  if (inB) return 'border-emerald-300 bg-emerald-50';
  return 'border-slate-200 hover:bg-slate-50';
}

// ---- Revision pills styling ----
function pillClass(revId: number): string {
  const i = selectedRevisionIds.value.indexOf(revId);
  if (i === 0) return 'border-blue-500 bg-blue-600 text-white';
  if (i === 1) return 'border-emerald-500 bg-emerald-600 text-white';
  return 'border-slate-200 bg-white text-slate-600 hover:border-slate-300';
}
function pillDot(revId: number, _i: number): string {
  return selectedRevisionIds.value.includes(revId) ? 'bg-white' : 'bg-slate-400';
}

function statusDot(status: RevisionStatus): string {
  return {
    draft: 'bg-slate-400',
    active: 'bg-emerald-500',
    deprecated: 'bg-amber-500',
  }[status];
}

// ---- Side panel: single parts view ----
interface OpenParts {
  spId: number;
  revId: number;
  spName: string;
  revLabel: string;
}
const openPartsRef = ref<OpenParts | null>(null);
const parts = ref<RevisionPart[]>([]);
const partsLoading = ref(false);

async function openParts(sp: DetailSubProduct, revId: number, revLabel: string) {
  if (openPartsRef.value?.revId === revId) {
    closePanel();
    return;
  }
  openPartsRef.value = { spId: sp.id, revId, spName: sp.name, revLabel };
  partsLoading.value = true;
  parts.value = [];
  try {
    const response = await subProductsApi.getRevisionParts(sp.id, revId);
    parts.value = response.data;
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.load_parts_failed'), 'error');
  } finally {
    partsLoading.value = false;
  }
}

// ---- Compare mode (2 product revisions selected) ----
const compareMode = computed(() => selectedRevisionIds.value.length === 2);
const compareResult = ref<CompareResult | null>(null);
const compareLoading = ref(false);

watch(
  selectedRevisionIds,
  async (ids) => {
    if (ids.length === 2) {
      openPartsRef.value = null; // compare summary takes the panel
      compareLoading.value = true;
      compareResult.value = null;
      try {
        const response = await productRevisionsApi.compare(ids[0], ids[1]);
        compareResult.value = response.data;
      } finally {
        compareLoading.value = false;
      }
    } else {
      compareResult.value = null;
    }
  },
  { deep: true },
);

const panelOpen = computed(() => compareMode.value || openPartsRef.value !== null);

function closePanel() {
  openPartsRef.value = null;
  if (compareMode.value) {
    // Closing the compare panel drops the second selection.
    selectedRevisionIds.value = selectedRevisionIds.value.slice(0, 1);
  }
}

function compareRowClass(status: string): string {
  return {
    added: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    removed: 'border-red-200 bg-red-50 text-red-700',
    changed: 'border-amber-200 bg-amber-50 text-amber-800',
    unchanged: 'border-slate-200 bg-white text-slate-600',
  }[status] ?? 'border-slate-200';
}

// ---- Modals ----
const revisionModalOpen = ref(false);
const subProductModalOpen = ref(false);
const addModalOpen = ref(false);
const sprModalOpen = ref(false);
const activeSubProduct = ref<DetailSubProduct | null>(null);
const modalSaving = ref(false);

function openNewSubProductRevision(sp: DetailSubProduct) {
  activeSubProduct.value = sp;
  sprModalOpen.value = true;
}

const linkedIdsForSelectedRevision = computed(() =>
  selectedRevisionIds.value.length === 1
    ? membership.value[selectedRevisionIds.value[0]] ?? []
    : [],
);

// Map every sub-product revision id -> its owning sub-product id.
const spRevToSubProduct = computed<Record<number, number>>(() => {
  const map: Record<number, number> = {};
  for (const sp of detail.value?.subProducts ?? []) {
    for (const rev of sp.revisions) map[rev.id] = sp.id;
  }
  return map;
});

// Sub-product ids already present in the selected product revision — used to
// stop the same sub-product being added twice.
const linkedSubProductIdsForSelectedRevision = computed(() =>
  linkedIdsForSelectedRevision.value
    .map((revId) => spRevToSubProduct.value[revId])
    .filter((v): v is number => v != null),
);

async function reload() {
  await store.fetchDetail(productId.value);
}

async function onCreateRevision(payload: NewRevisionPayload) {
  modalSaving.value = true;
  try {
    await store.createRevision(productId.value, payload);
    notify.showToast(t('success.save_revision'), 'success');
    revisionModalOpen.value = false;
    await reload();
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.save_revision_failed'), 'error');
  } finally {
    modalSaving.value = false;
  }
}

async function onCreateSubProduct(
  payload: SubProductPayload,
  addToRevisionId: number | null,
) {
  modalSaving.value = true;
  try {
    const res = await subProductsApi.create(payload);
    const newRev = res.data.revisions?.[0];

    if (addToRevisionId && newRev) {
      // Link the new sub-product's Rev. 1 into the chosen product revision.
      const existing = membership.value[addToRevisionId] ?? [];
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
    }
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.save_sub_product_failed'), 'error');
  } finally {
    modalSaving.value = false;
  }
}

async function onCreateSubProductRevision(payload: NewSubProductRevisionPayload) {
  if (!activeSubProduct.value) return;
  modalSaving.value = true;
  try {
    await subProductsApi.createRevision(activeSubProduct.value.id, payload);
    notify.showToast(t('success.save_sub_product_revision'), 'success');
    sprModalOpen.value = false;
    notify.showToast(t('sub_product_revision_created_hint'), 'info');
    await reload();
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.save_sub_product_revision_failed'),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

async function onAddSubProducts(subProductRevisionIds: number[]) {
  if (selectedRevisionIds.value.length !== 1) return;
  modalSaving.value = true;
  try {
    await productRevisionsApi.setSubProducts(
      selectedRevisionIds.value[0],
      subProductRevisionIds,
    );
    notify.showToast(t('success.update_revision'), 'success');
    addModalOpen.value = false;
    await reload();
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.update_revision_failed'), 'error');
  } finally {
    modalSaving.value = false;
  }
}

onMounted(reload);

// Reset selection when navigating to a different product.
watch(productId, () => {
  selectedRevisionIds.value = [];
  openPartsRef.value = null;
  reload();
});
</script>
