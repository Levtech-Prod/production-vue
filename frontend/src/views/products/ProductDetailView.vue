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
      <!-- Archived banner -->
      <div
        v-if="isArchived"
        class="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        <Archive class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>{{ t('archived_product_banner') }}</span>
      </div>

      <!-- Info bar -->
      <div class="card p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
          <img
            v-if="detail.image"
            :src="detail.image"
            class="h-24 w-24 shrink-0 rounded-xl border border-slate-200 object-cover"
            :alt="detail.name"
          />
          <div
            v-else
            class="grid h-24 w-24 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-100 text-2xl text-slate-300"
          >
            ▣
          </div>

          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-bold">{{ detail.name }}</h1>
            <div class="font-mono text-sm text-slate-500">{{ detail.sku }}</div>
            <p v-if="detail.description" class="mt-2 text-sm text-slate-500">
              {{ detail.description }}
            </p>
          </div>
        </div>

        <!-- Stats -->
        <dl
          class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('type') }}</dt>
            <dd class="mt-0.5 font-semibold text-slate-800">{{ detail.type || '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('revisions') }}</dt>
            <dd class="mt-0.5 font-semibold text-slate-800">{{ detail.revisions.length }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('sub_products') }}</dt>
            <dd class="mt-0.5 font-semibold text-slate-800">{{ detail.subProducts.length }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('default_revision') }}</dt>
            <dd class="mt-0.5 flex items-center gap-1 font-semibold text-slate-800">
              <Star
                v-if="defaultRevisionLabel"
                class="h-3.5 w-3.5 fill-amber-400 text-amber-400"
              />
              {{ defaultRevisionLabel || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('created_at') }}</dt>
            <dd class="mt-0.5 font-semibold text-slate-800">{{ formatDate(detail.createdAt) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">{{ t('last_updated') }}</dt>
            <dd class="mt-0.5 font-semibold text-slate-800">{{ formatDate(detail.updatedAt) }}</dd>
          </div>
        </dl>
      </div>

      <!-- Revision selector -->
      <div class="mt-6 flex flex-wrap items-center gap-2">
        <span class="mr-1 text-sm font-medium text-slate-500"
          >{{ t('revisions') }}:</span
        >
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
          <Star
            v-if="rev.id === detail.defaultRevisionId"
            class="h-3 w-3 fill-current"
            :title="t('default_revision')"
          />
        </button>

        <button
          v-if="!isArchived"
          type="button"
          class="ml-1 inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600"
          @click="revisionModalOpen = true"
        >
          <Plus class="h-3.5 w-3.5" /> {{ t('new_revision') }}
        </button>

        <button
          v-if="canSetDefault && !isArchived"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-amber-300 px-3 py-1 text-sm text-amber-600 hover:bg-amber-50"
          @click="onSetDefaultRevision"
        >
          <Star class="h-3.5 w-3.5" /> {{ t('set_as_default') }}
        </button>

        <div v-if="!isArchived" class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="btn-secondary !py-1.5 !text-xs inline-flex items-center gap-1"
            @click="subProductModalOpen = true"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('new_sub_product') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="selectedRevisionIds.length !== 1"
            :title="
              selectedRevisionIds.length !== 1
                ? t('select_one_revision_hint')
                : ''
            "
            @click="addModalOpen = true"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('add_sub_product') }}
          </button>
        </div>
      </div>

      <p
        v-if="selectedRevisionIds.length === 2"
        class="mt-2 text-sm text-blue-600"
      >
        {{ t('two_revisions_selected_hint') }}
      </p>

      <!-- Main grid: sub-product table + side panel -->
      <div class="mt-4 grid gap-4 lg:grid-cols-[32rem_1fr]">
        <!-- Sub-product table -->
        <div class="card overflow-hidden">
          <div class="border-b border-slate-100 px-4 py-3">
            <h2 class="font-semibold text-slate-700">
              {{ t('sub_products') }}
            </h2>
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
                <div class="flex min-w-0 items-center gap-2.5">
                  <img
                    v-if="sp.image"
                    :src="sp.image"
                    class="h-9 w-9 shrink-0 rounded-lg border border-slate-200 object-cover"
                    :alt="sp.name"
                  />
                  <div
                    v-else
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
                  >
                    ▣
                  </div>
                  <div class="min-w-0">
                    <div class="truncate font-semibold text-slate-800">
                      {{ sp.name }}
                    </div>
                    <div class="truncate font-mono text-xs text-slate-400">
                      {{ sp.sku }}
                    </div>
                  </div>
                </div>
                <button
                  v-if="!isArchived"
                  type="button"
                  class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                  :title="t('new_revision')"
                  @click="openNewSubProductRevision(sp)"
                >
                  <Plus class="h-4 w-4" />
                </button>
              </div>

              <div class="mt-2 flex flex-col">
                <button
                  v-for="rev in sp.revisions"
                  :key="rev.id"
                  type="button"
                  class="flex items-center justify-between gap-2 rounded-r-md border-l-2 py-1 pl-2.5 pr-1 text-left text-sm transition-colors"
                  :class="rowClass(sp, rev.id)"
                  @click="openParts(sp, rev.id, rev.label)"
                >
                  <span class="flex items-center gap-2 truncate">
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full"
                      :class="statusDot(rev.status)"
                    />
                    <span class="truncate">{{ rev.label }}</span>
                  </span>
                  <span class="flex shrink-0 items-center gap-0.5 text-xs text-slate-400">
                    {{ t('view_parts') }}
                    <ChevronRight class="h-3.5 w-3.5" />
                  </span>
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- Side panel: parts (single) / compare summary -->
        <aside
          v-if="panelOpen"
          class="card flex max-h-[70vh] flex-col overflow-hidden"
        >
          <div
            class="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"
          >
            <h3 class="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
              <template v-if="compareMode">{{ t('comparison') }}</template>
              <template v-else>
                <span class="truncate">
                  {{ t('parts_of', { name: openPartsRef?.spName }) }}
                </span>
                <span
                  v-if="openPartsRef?.revLabel"
                  class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                >
                  {{ openPartsRef.revLabel }}
                </span>
              </template>
            </h3>
            <button
              type="button"
              class="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              @click="closePanel"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- Compare summary (2 product revisions selected) -->
          <div v-if="compareMode" class="flex-1 overflow-y-auto p-4">
            <div
              v-if="compareLoading"
              class="py-6 text-center text-sm text-slate-400"
            >
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
                  <span class="text-xs uppercase">{{
                    t('compare_status.' + row.status)
                  }}</span>
                </div>
                <div class="mt-1 flex gap-3 text-xs text-slate-500">
                  <span>A: {{ row.inA ? row.inA.revisionLabel : '—' }}</span>
                  <span>B: {{ row.inB ? row.inB.revisionLabel : '—' }}</span>
                </div>
              </li>
            </ul>
          </div>

          <!-- Single revision parts list -->
          <div v-else class="flex-1 overflow-y-auto">
            <div
              v-if="partsLoading"
              class="py-6 text-center text-sm text-slate-400"
            >
              {{ t('loading') }}
            </div>
            <div
              v-else-if="parts.length === 0"
              class="py-6 text-center text-sm text-slate-400"
            >
              {{ t('no_parts_in_revision') }}
            </div>
            <template v-else>
              <!-- Column header -->
              <div
                class="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500"
              >
                <span>{{ t('part') }}</span>
                <span>{{ t('quantity') }}</span>
              </div>
              <ul class="flex flex-col divide-y divide-slate-100">
                <li
                  v-for="part in parts"
                  :key="part.id"
                  class="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <div class="flex min-w-0 items-center gap-2.5">
                    <img
                      v-if="part.image"
                      :src="part.image"
                      class="h-8 w-8 shrink-0 rounded-md border border-slate-200 object-cover"
                      :alt="part.name"
                    />
                    <div
                      v-else
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-100 text-slate-300"
                    >
                      ▣
                    </div>
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-slate-800">
                        {{ part.name }}
                      </div>
                      <div class="truncate font-mono text-xs text-slate-400">
                        {{ part.code }}
                      </div>
                    </div>
                  </div>
                  <div class="shrink-0 text-right text-sm">
                    <span class="font-semibold">{{ part.quantity }}</span>
                    <span class="text-slate-400"> {{ part.unit || '' }}</span>
                  </div>
                </li>
              </ul>
            </template>
          </div>
        </aside>
      </div>
    </div>

    <div v-else class="py-16 text-center text-slate-400">
      {{ t('loading') }}
    </div>

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
import { ChevronLeft, ChevronRight, Plus, X, Star, Archive } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import RevisionModal from './RevisionModal.vue';
import SubProductModal from './SubProductModal.vue';
import AddSubProductModal from './AddSubProductModal.vue';
import SubProductRevisionModal from './SubProductRevisionModal.vue';
import { useProductsStore } from '../../stores/productsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import {
  productsApi,
  subProductsApi,
  productRevisionsApi,
} from '../../api/productsAPI.ts';
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
const isArchived = computed(() => detail.value?.status === 'archived');

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

// ---- Default revision ----
const defaultRevisionLabel = computed(() => {
  const id = detail.value?.defaultRevisionId;
  if (id == null) return '';
  return detail.value?.revisions.find((r) => r.id === id)?.label ?? '';
});

const canSetDefault = computed(
  () =>
    selectedRevisionIds.value.length === 1 &&
    selectedRevisionIds.value[0] !== detail.value?.defaultRevisionId,
);

async function onSetDefaultRevision() {
  if (selectedRevisionIds.value.length !== 1) return;
  try {
    await productsApi.setDefaultRevision(
      productId.value,
      selectedRevisionIds.value[0],
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
  return new Set(revId != null ? (membership.value[revId] ?? []) : []);
}

const setA = computed(() => selectedSetFor(0));
const setB = computed(() => selectedSetFor(1));

function isSpDimmed(sp: DetailSubProduct): boolean {
  if (selectedRevisionIds.value.length === 0) return false;
  return !sp.revisions.some(
    (r) => setA.value.has(r.id) || setB.value.has(r.id),
  );
}

// Colour a revision line by which selected product revision(s) contain it.
// Uses a left-border accent (border-l-2) rather than a full boxed button.
function rowClass(_sp: DetailSubProduct, spRevId: number): string {
  const inA = setA.value.has(spRevId);
  const inB = setB.value.has(spRevId);
  const isOpen = openPartsRef.value?.revId === spRevId;
  if (isOpen) return 'border-blue-500 bg-blue-50 text-blue-700';
  if (inA && inB) return 'border-violet-400 bg-violet-50/60';
  if (inA) return 'border-blue-400 bg-blue-50/60';
  if (inB) return 'border-emerald-400 bg-emerald-50/60';
  return 'border-transparent hover:bg-slate-50';
}

// ---- Revision pills styling ----
function pillClass(revId: number): string {
  const i = selectedRevisionIds.value.indexOf(revId);
  if (i === 0) return 'border-blue-500 bg-blue-600 text-white';
  if (i === 1) return 'border-emerald-500 bg-emerald-600 text-white';
  return 'border-slate-200 bg-white text-slate-600 hover:border-slate-300';
}
function pillDot(revId: number, _i: number): string {
  return selectedRevisionIds.value.includes(revId)
    ? 'bg-white'
    : 'bg-slate-400';
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

async function openParts(
  sp: DetailSubProduct,
  revId: number,
  revLabel: string,
) {
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
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.load_parts_failed'),
      'error',
    );
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

const panelOpen = computed(
  () => compareMode.value || openPartsRef.value !== null,
);

function closePanel() {
  openPartsRef.value = null;
  if (compareMode.value) {
    // Closing the compare panel drops the second selection.
    selectedRevisionIds.value = selectedRevisionIds.value.slice(0, 1);
  }
}

function compareRowClass(status: string): string {
  return (
    {
      added: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      removed: 'border-red-200 bg-red-50 text-red-700',
      changed: 'border-amber-200 bg-amber-50 text-amber-800',
      unchanged: 'border-slate-200 bg-white text-slate-600',
    }[status] ?? 'border-slate-200'
  );
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
    ? (membership.value[selectedRevisionIds.value[0]] ?? [])
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
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.save_revision_failed'),
      'error',
    );
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
  modalSaving.value = true;
  try {
    await subProductsApi.createRevision(activeSubProduct.value.id, payload);
    notify.showToast(t('success.save_sub_product_revision'), 'success');
    sprModalOpen.value = false;
    notify.showToast(t('sub_product_revision_created_hint'), 'info');
    await reload();
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
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.update_revision_failed'),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

// On initial load / navigation, default to the product's default revision
// (falling back to the latest) and open the first sub-product revision that
// belongs to it.
function applyDefaults() {
  const d = detail.value;
  if (!d || d.revisions.length === 0) return;
  const latest = d.revisions.reduce((a, b) =>
    b.revisionNumber > a.revisionNumber ? b : a,
  );
  const initial =
    d.defaultRevisionId != null &&
    d.revisions.some((r) => r.id === d.defaultRevisionId)
      ? d.defaultRevisionId
      : latest.id;
  selectedRevisionIds.value = [initial];

  const memberSet = new Set(membership.value[initial] ?? []);
  for (const sp of d.subProducts) {
    const rev = sp.revisions.find((r) => memberSet.has(r.id));
    if (rev) {
      openParts(sp, rev.id, rev.label);
      break;
    }
  }
}

async function loadAndApplyDefaults() {
  await reload();
  applyDefaults();
}

onMounted(loadAndApplyDefaults);

// Reset selection when navigating to a different product.
watch(productId, () => {
  selectedRevisionIds.value = [];
  openPartsRef.value = null;
  loadAndApplyDefaults();
});
</script>
