<template>
  <div>
    <div class="card overflow-hidden">
      <!-- Toolbar -->
      <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">

        <!-- Status tab filter -->
        <div class="flex overflow-hidden rounded-lg border border-slate-200 text-sm font-medium">
          <button
            type="button"
            class="px-4 py-2 transition-colors"
            :class="filterStatus === 'active' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'"
            @click="filterStatus = 'active'"
          >
            {{ t('status_active') }}
          </button>
          <button
            type="button"
            class="border-l border-slate-200 px-4 py-2 transition-colors"
            :class="filterStatus === 'archived' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'"
            @click="filterStatus = 'archived'"
          >
            {{ t('status_archived') }}
          </button>
        </div>

        <!-- Name filter -->
        <div class="relative max-w-xs flex-1">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            v-model="filterName"
            class="input !pl-9"
            :placeholder="t('name')"
          />
        </div>

        <!-- SKU filter -->
        <div class="relative max-w-xs flex-1">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            v-model="filterSku"
            class="input !pl-9"
            placeholder="SKU"
          />
        </div>

        <!-- Type filter -->
        <select v-model="filterType" class="input max-w-xs flex-1">
          <option value="">{{ t('type') }}: {{ t('all') }}</option>
          <option v-for="type in uniqueTypes" :key="type" :value="type">{{ type }}</option>
        </select>

        <button
          v-if="filterName || filterSku || filterType"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
          @click="filterName = ''; filterSku = ''; filterType = ''"
        >
          <X class="h-4 w-4" />
          {{ t('clear_filters') }}
        </button>

        <span class="text-sm text-slate-400">
          {{ filtered.length }} / {{ productsByStatus.length }}
        </span>

        <button
          class="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
          @click="openModal()"
        >
          <Plus class="h-4 w-4" />
          {{ t('add_product') }}
        </button>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="table-head text-xs">
          <!-- Sort row -->
          <tr>
            <th class="p-4">{{ t('image') }}</th>
            <th class="p-4">
              <button
                class="inline-flex items-center gap-1 hover:text-slate-700"
                @click="toggleSort('sku')"
              >
                SKU
                <ChevronUp v-if="sortKey === 'sku' && sortDir === 'asc'" class="h-3 w-3" />
                <ChevronDown v-else-if="sortKey === 'sku' && sortDir === 'desc'" class="h-3 w-3" />
                <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
              </button>
            </th>
            <th class="p-4">
              <button
                class="inline-flex items-center gap-1 hover:text-slate-700"
                @click="toggleSort('name')"
              >
                {{ t('name') }}
                <ChevronUp v-if="sortKey === 'name' && sortDir === 'asc'" class="h-3 w-3" />
                <ChevronDown v-else-if="sortKey === 'name' && sortDir === 'desc'" class="h-3 w-3" />
                <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
              </button>
            </th>
            <th class="p-4">
              <button
                class="inline-flex items-center gap-1 hover:text-slate-700"
                @click="toggleSort('type')"
              >
                {{ t('type') }}
                <ChevronUp v-if="sortKey === 'type' && sortDir === 'asc'" class="h-3 w-3" />
                <ChevronDown v-else-if="sortKey === 'type' && sortDir === 'desc'" class="h-3 w-3" />
                <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
              </button>
            </th>
            <th class="p-4">
              <button
                class="inline-flex items-center gap-1 hover:text-slate-700"
                @click="toggleSort('revisions')"
              >
                {{ t('revisions') }}
                <ChevronUp v-if="sortKey === 'revisions' && sortDir === 'asc'" class="h-3 w-3" />
                <ChevronDown v-else-if="sortKey === 'revisions' && sortDir === 'desc'" class="h-3 w-3" />
                <ChevronsUpDown v-else class="h-3 w-3 opacity-40" />
              </button>
            </th>
            <th class="p-4">{{ t('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="6" class="py-12 text-center text-sm text-slate-400">
              <template v-if="filterName || filterSku || filterType">{{ t('no_search_results') }}.</template>
              <template v-else-if="filterStatus === 'archived'">{{ t('no_archived_products_msg') }}</template>
              <template v-else>{{ t('no_products_msg') }}</template>
            </td>
          </tr>
          <tr
            v-for="product in filtered"
            :key="product.id"
            class="cursor-pointer border-t border-slate-100 even:bg-slate-50 transition-colors hover:bg-slate-200"
            :class="{ 'opacity-60': product.status === 'archived' }"
            @click="openDetail(product.id)"
          >
            <td class="p-4">
              <img
                v-if="product.image"
                :src="product.image"
                class="h-12 w-12 rounded-lg border border-slate-200 object-cover"
                :alt="product.name"
              />
              <div
                v-else
                class="grid h-12 w-12 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
              >
                ▣
              </div>
            </td>
            <td class="p-4 font-mono text-xs text-slate-600">{{ product.sku }}</td>
            <td class="p-4 font-semibold">{{ product.name }}</td>
            <td class="p-4 text-slate-500">{{ product.type || '—' }}</td>
            <td class="p-4">
              <div class="flex flex-wrap gap-1.5">
                <RevisionChip
                  v-for="rev in product.revisions"
                  :key="rev.id"
                  :label="rev.label"
                  :status="rev.status"
                  :highlight="rev.id === highlightedRevisionId(product)"
                />
                <span v-if="!product.revisions.length" class="text-slate-300">—</span>
              </div>
            </td>
            <td class="p-4" @click.stop>
              <div class="flex items-center gap-2">
                <!-- Edit: only for active products -->
                <button
                  v-if="product.status === 'active'"
                  type="button"
                  class="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                  :title="t('edit')"
                  @click="openModal(product)"
                >
                  <Pencil class="h-4 w-4" />
                </button>

                <!-- Open detail -->
                <button
                  type="button"
                  class="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  :title="t('open')"
                  @click="openDetail(product.id)"
                >
                  <Eye class="h-4 w-4" />
                </button>

                <!-- Archive: only for active products -->
                <button
                  v-if="product.status === 'active'"
                  type="button"
                  class="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                  :title="t('archive')"
                  @click="promptArchive(product)"
                >
                  <Archive class="h-4 w-4" />
                </button>

                <!-- Re-activate: only for archived products -->
                <button
                  v-if="product.status === 'archived'"
                  type="button"
                  class="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                  :title="t('activate')"
                  @click="promptActivate(product)"
                >
                  <ArchiveRestore class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ProductModal
      v-model="modalOpen"
      :product="editing"
      :save-error="saveError"
      :saving="saving"
      @saved="onSaved"
    />

    <!-- Archive confirmation modal -->
    <ConfirmModal
      :visible="archiveModalVisible"
      :title="t('archive')"
      :message="t('confirmations.archive_product_msg')"
      :confirm-text="t('archive')"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="archiveModalVisible = false"
    />

    <!-- Re-activate confirmation modal -->
    <ConfirmModal
      :visible="activateModalVisible"
      :title="t('activate')"
      :message="activateModalMessage"
      :confirm-text="t('activate')"
      :loading="activating"
      @confirm="confirmActivate"
      @cancel="activateModalVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Pencil, Eye, ChevronUp, ChevronDown, ChevronsUpDown, Archive, ArchiveRestore, Search, X, Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import ProductModal from './ProductModal.vue';
import RevisionChip from './RevisionChip.vue';
import ConfirmModal from '../../components/notification/ConfirmModal.vue';
import { useProductsStore } from '../../stores/productsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import type { ProductSummary, ProductPayload, ProductStatus } from '../../types/products.ts';

const { t, te } = useI18n();
const router = useRouter();
const store = useProductsStore();
const notify = useNotificationStore();

const products = computed(() => store.list);

// ---- Sorting ----------------------------------------------------------------

type SortKey = 'sku' | 'name' | 'type' | 'revisions';
type SortDir = 'asc' | 'desc';

const sortKey = ref<SortKey | null>(null);
const sortDir = ref<SortDir>('asc');

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : (sortKey.value = null, 'asc');
  } else {
    sortKey.value = key;
    sortDir.value = 'asc';
  }
}

// Lookup table so the comparator stays free of branching.
const SORT_GETTER: Record<SortKey, (p: ProductSummary) => string | number> = {
  sku: (p) => p.sku,
  name: (p) => p.name,
  type: (p) => p.type ?? '',
  revisions: (p) => p.revisions.length,
};

function compareProducts(a: ProductSummary, b: ProductSummary): number {
  const get = SORT_GETTER[sortKey.value!];
  const aVal = get(a);
  const bVal = get(b);
  if (aVal < bVal) return sortDir.value === 'asc' ? -1 : 1;
  if (aVal > bVal) return sortDir.value === 'asc' ? 1 : -1;
  return 0;
}

// ---- Filters ----------------------------------------------------------------

const filterStatus = ref<ProductStatus>('active');
const filterName = ref('');
const filterSku = ref('');
const filterType = ref('');

// Products in the active status tab — denominator for the count display.
const productsByStatus = computed(() =>
  products.value.filter((p) => p.status === filterStatus.value),
);

const uniqueTypes = computed(() => {
  const types = productsByStatus.value.map((p) => p.type).filter((v): v is string => !!v);
  return [...new Set(types)].sort();
});

const filtered = computed(() => {
  const name = filterName.value.toLowerCase();
  const sku = filterSku.value.toLowerCase();

  const list = productsByStatus.value
    .filter((p) => !name || p.name.toLowerCase().includes(name))
    .filter((p) => !sku || p.sku.toLowerCase().includes(sku))
    .filter((p) => !filterType.value || (p.type ?? '') === filterType.value);

  return sortKey.value ? list.sort(compareProducts) : list;
});

// Revision highlighted in the row: the product's default revision if set,
// otherwise the latest (highest revision number) as a fallback.
function highlightedRevisionId(product: ProductSummary): number | null {
  if (!product.revisions.length) return null;
  const { defaultRevisionId, revisions } = product;
  if (defaultRevisionId != null && revisions.some((r) => r.id === defaultRevisionId))
    return defaultRevisionId;
  return revisions.reduce((a, b) => (b.revisionNumber > a.revisionNumber ? b : a)).id;
}

// ---- Product modal ----------------------------------------------------------

const modalOpen = ref(false);
const editing = ref<ProductSummary | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);

function openModal(product: ProductSummary | null = null) {
  editing.value = product;
  saveError.value = null;
  modalOpen.value = true;
}

function openDetail(id: number) {
  router.push(`/products/${id}`);
}

async function onSaved(payload: ProductPayload) {
  saving.value = true;
  saveError.value = null;
  try {
    if (editing.value) {
      await store.updateProduct(editing.value.id, payload);
      notify.showToast(t('success.update_product'), 'success');
    } else {
      await store.createProduct(payload);
      notify.showToast(t('success.save_product'), 'success');
    }
    modalOpen.value = false;
    await store.fetchList();
  } catch (err: any) {
    saveError.value = translateApiError(err, { t, te }, 'errors.save_product_failed');
  } finally {
    saving.value = false;
  }
}

// ---- Archive / activate -----------------------------------------------------

const archiveModalVisible = ref(false);
const productToArchive = ref<ProductSummary | null>(null);
const archiving = ref(false);

// Picks the toast copy for a status change. Reactivation can silently rename
// the SKU on the backend (resolveSkuConflictOnReactivate) when another active
// product has since taken it — surface that here so the user isn't left
// wondering why the SKU looks different.
function statusChangeMessage(status: ProductStatus, previousSku: string, updatedSku: string): string {
  if (status === 'archived') return t('success.archive_product');
  return updatedSku === previousSku
    ? t('success.activate_product')
    : t('success.activate_product_sku_changed', { oldSku: previousSku, newSku: updatedSku });
}

// Shared status-change handler — updates store, shows toast, swallows errors.
async function changeStatus(product: ProductSummary, status: ProductStatus): Promise<boolean> {
  try {
    const updated = await store.setProductStatus(product.id, status);
    notify.showToast(statusChangeMessage(status, product.sku, updated.sku), 'success');
    return true;
  } catch (err: any) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.set_product_status_failed'), 'error');
    return false;
  }
}

function promptArchive(product: ProductSummary) {
  productToArchive.value = product;
  archiveModalVisible.value = true;
}

async function confirmArchive() {
  if (!productToArchive.value) return;
  archiving.value = true;
  const ok = await changeStatus(productToArchive.value, 'archived');
  archiving.value = false;
  if (ok) {
    archiveModalVisible.value = false;
    productToArchive.value = null;
  }
}

const activateModalVisible = ref(false);
const productToActivate = ref<ProductSummary | null>(null);
const activating = ref(false);

// True when a different *active* product already holds this SKU — the sign
// that reactivating will trigger the backend's automatic SKU suffixing
// (resolveSkuConflictOnReactivate). Used to warn the user up front.
function hasActiveSkuConflict(product: ProductSummary): boolean {
  return products.value.some(
    (p) => p.id !== product.id && p.status === 'active' && p.sku === product.sku,
  );
}

const activateModalMessage = computed(() => {
  const product = productToActivate.value;
  if (!product) return '';
  return hasActiveSkuConflict(product)
    ? t('confirmations.activate_product_sku_conflict_msg', { sku: product.sku })
    : t('confirmations.activate_product_msg');
});

function promptActivate(product: ProductSummary) {
  productToActivate.value = product;
  activateModalVisible.value = true;
}

async function confirmActivate() {
  if (!productToActivate.value) return;
  activating.value = true;
  const ok = await changeStatus(productToActivate.value, 'active');
  activating.value = false;
  if (ok) {
    activateModalVisible.value = false;
    productToActivate.value = null;
  }
}

onMounted(() => {
  store.fetchList();
});
</script>
