<template>
  <!-- The min-height reserves room under the add row for the product
       dropdown, which is absolutely positioned and would otherwise be
       clipped by the modal's scrolling body on a project with few lines. -->
  <div class="min-h-[24rem] rounded-xl border border-slate-200">
    <div class="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
      <h3 class="text-sm font-semibold text-slate-700">
        {{ t('project_products') }} <span class="text-red-500">*</span>
      </h3>
      <span class="text-xs text-slate-400">{{ model.length }}</span>
    </div>

    <!-- Add a product at a revision. Deliberately not `AddPartsModal` (a
         modal of its own, which would have to open on top of this one) nor
         `PartsPicker` (a parts list whose columns are quantity/unit/mount
         position): the shape below is the same idea over products and their
         revisions. The revision is chosen before the line is added, so
         adding the same product a second time at a different revision —
         legal per §3.2 — is a deliberate choice rather than a guess. -->
    <div class="flex items-start gap-2 border-b border-slate-100 px-4 py-3">
      <div ref="pickerRoot" class="relative min-w-0 flex-1">
        <div class="relative">
          <Search
            class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          />
          <input
            v-model="search"
            type="text"
            class="input !py-1.5 !pl-8 !pr-8 text-sm"
            :placeholder="t('select_product')"
            @focus="openPicker"
            @keydown.enter.prevent="pickFirstMatch"
            @keydown.escape="pickerOpen = false"
          />
          <button
            v-if="search"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            :title="t('clear')"
            @click="clearSearch"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          v-if="pickerOpen"
          class="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <p v-if="productsStore.loading" class="py-4 text-center text-sm text-slate-400">
            {{ t('loading') }}
          </p>
          <div v-else-if="loadError" class="py-4 text-center text-sm">
            <p class="text-red-500">{{ loadError }}</p>
            <button
              type="button"
              class="mt-2 text-sm font-medium text-blue-600 hover:underline"
              @click="loadProducts"
            >
              {{ t('retry') }}
            </button>
          </div>
          <p v-else-if="matches.length === 0" class="py-4 text-center text-sm text-slate-400">
            {{ search.trim() ? t('no_products_found') : t('no_products_in_catalog') }}
          </p>
          <ul v-else class="max-h-56 divide-y divide-slate-100 overflow-y-auto">
            <li v-for="product in matches" :key="product.id">
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                :class="product.id === selectedProductId ? 'bg-blue-50' : ''"
                @click="selectProduct(product)"
              >
                <span class="block truncate font-medium text-slate-800">{{ product.name }}</span>
                <span class="block truncate font-mono text-xs text-slate-400">
                  {{ product.sku }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      <select
        v-model="revisionChoice"
        class="input !w-40 !py-1.5 shrink-0 text-sm disabled:opacity-40"
        :title="t('revision')"
        :disabled="addableRevisions.length === 0"
      >
        <option v-if="addableRevisions.length === 0" :value="null">
          {{ selectedProduct ? t('all_revisions_added') : t('revision') }}
        </option>
        <option v-for="rev in addableRevisions" :key="rev.id" :value="rev.id">
          {{ rev.label }}
        </option>
      </select>

      <button
        type="button"
        class="btn-secondary shrink-0 !py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="revisionChoice === null"
        @click="addProduct"
      >
        {{ t('add') }}
      </button>
    </div>

    <table v-if="model.length" class="w-full text-left text-sm">
      <thead class="table-head text-xs">
        <tr>
          <th class="px-4 py-2">{{ t('product') }}</th>
          <th class="w-48 px-4 py-2">{{ t('revision') }}</th>
          <th class="w-28 px-4 py-2">{{ t('quantity') }} <span class="text-red-500">*</span></th>
          <th class="w-10 px-4 py-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in model"
          :key="i"
          class="border-t border-slate-100 even:bg-slate-50"
        >
          <td class="px-4 py-1.5">
            <span class="font-medium text-slate-800">{{ productOf(row)?.name ?? '—' }}</span>
            <span class="ml-2 font-mono text-xs text-slate-400">{{ productOf(row)?.sku }}</span>
          </td>
          <td class="px-4 py-1.5">
            <select v-model.number="row.productRevisionId" class="input !py-1">
              <option
                v-for="rev in revisionsOf(row)"
                :key="rev.id"
                :value="rev.id"
                :disabled="isPinnedElsewhere(row, rev.id)"
              >
                {{ rev.label }}
              </option>
            </select>
          </td>
          <td class="px-4 py-1.5">
            <input
              v-model.number="row.quantity"
              type="number"
              min="1"
              step="1"
              class="input !py-1"
              @keydown="blockNonIntegerKeys"
            />
            <p v-if="fieldErrors[`quantity-${i}`]" class="mt-1 text-xs text-red-500">
              {{ fieldErrors[`quantity-${i}`] }}
            </p>
          </td>
          <td class="px-4 py-1.5">
            <button
              type="button"
              class="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
              :title="t('delete')"
              @click="model.splice(i, 1)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p
      v-else
      class="px-4 py-6 text-center text-sm"
      :class="fieldErrors.products ? 'text-red-500' : 'text-slate-400'"
    >
      {{ fieldErrors.products || t('no_products_selected') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search, Trash2, X } from 'lucide-vue-next';
import { useProductsStore } from '../../stores/productsStore.ts';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import { blockNonIntegerKeys } from '../../utils/numberInput.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { useClickOutside } from '../../composables/useClickOutside.ts';
import type { ProductRevision, ProductSummary } from '../../types/products.ts';
import type { ProjectProductInput } from '../../types/projects.ts';

const { t, te } = useI18n();
const productsStore = useProductsStore();

// v-model: the payload's `products` array, edited in place.
const model = defineModel<ProjectProductInput[]>({ default: () => [] });

const search = ref('');
const loadError = ref<string | null>(null);
const pickerOpen = ref(false);
const pickerRoot = ref<HTMLElement | null>(null);
const selectedProductId = ref<number | null>(null);
const revisionChoice = ref<number | null>(null);

useClickOutside(pickerRoot, () => {
  pickerOpen.value = false;
});

// The catalog is re-read every time the editor mounts — the modal unmounts it
// on close, so this is one request per open, and a project must be pinned
// against the products that exist now, not whatever a previous page cached.
async function loadProducts() {
  loadError.value = null;
  try {
    await productsStore.fetchList();
  } catch (err) {
    // Without this the picker would render "no products" for a failed
    // request, which reads as an empty catalog.
    loadError.value = translateApiError(err, { t, te }, 'errors.load_products_failed');
  }
}

const productById = computed(
  () => new Map(productsStore.list.map((p) => [p.id, p])),
);

function productOf(row: ProjectProductInput): ProductSummary | undefined {
  return productById.value.get(row.productId);
}

// Archived products stay resolvable for rows a project already pinned, but
// are not offered for new ones. Tested against 'archived' rather than for
// 'active' so a product the API sends without a status is still offered.
const matches = computed(() => {
  const q = search.value.trim().toLowerCase();
  return productsStore.list.filter(
    (p) =>
      p.status !== 'archived' &&
      (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)),
  );
});

function newestFirst(revisions: ProductRevision[]): ProductRevision[] {
  return [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
}

/** A product's revisions newest first, for the staged row's picker. */
function revisionsOf(row: ProjectProductInput): ProductRevision[] {
  return newestFirst(productOf(row)?.revisions ?? []);
}

const pinnedRevisionIds = computed(
  () => new Set(model.value.map((row) => row.productRevisionId)),
);

const selectedProduct = computed(() =>
  selectedProductId.value == null ? null : productById.value.get(selectedProductId.value),
);

/** Revisions of the selected product that are not in the project yet. A
 *  revision may be pinned once (project_products' UNIQUE), so an exhausted
 *  product is prevented here rather than left to the 422. */
const addableRevisions = computed(() =>
  newestFirst(selectedProduct.value?.revisions ?? []).filter(
    (rev) => !pinnedRevisionIds.value.has(rev.id),
  ),
);

/** The product's default revision when it is still free, otherwise its
 *  newest free one — the same "which revision stands for this product" rule
 *  `ProductsListView`'s `highlightedRevisionId` uses. */
function defaultChoice(): number | null {
  const product = selectedProduct.value;
  if (!product) return null;
  const preferred = addableRevisions.value.find(
    (rev) => rev.id === product.defaultRevisionId,
  );
  return (preferred ?? addableRevisions.value[0])?.id ?? null;
}

function openPicker() {
  pickerOpen.value = true;
}

function clearChoice() {
  selectedProductId.value = null;
  revisionChoice.value = null;
}

function selectProduct(product: ProductSummary) {
  selectedProductId.value = product.id;
  search.value = product.name;
  pickerOpen.value = false;
  revisionChoice.value = defaultChoice();
}

function pickFirstMatch() {
  if (pickerOpen.value && matches.value.length) selectProduct(matches.value[0]);
}

function clearSearch() {
  clearChoice();
  search.value = '';
  openPicker();
}

// Typing past a chosen product drops the choice, so Add can never pin a
// product the box no longer names.
watch(search, (value) => {
  if (selectedProduct.value && value !== selectedProduct.value.name) {
    clearChoice();
    openPicker();
  }
});

function addProduct() {
  const productId = selectedProductId.value;
  const productRevisionId = revisionChoice.value;
  if (productId == null || productRevisionId == null) return;
  model.value.push({ productId, productRevisionId, quantity: 1 });
  clearChoice();
  search.value = '';
  pickerOpen.value = false;
}

/** True when another line already pins this revision — the option stays
 *  listed but unselectable, so the reason is visible. */
function isPinnedElsewhere(row: ProjectProductInput, revisionId: number): boolean {
  return model.value.some(
    (other) => other !== row && other.productRevisionId === revisionId,
  );
}

const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() => [
  {
    key: 'products',
    label: t('project_products'),
    missing: model.value.length === 0,
  },
  ...model.value.map((row, i) => ({
    key: `quantity-${i}`,
    label: t('quantity'),
    missing: !(Number(row.quantity) >= 1),
  })),
]);

// Called by the parent form on submit / reopen.
defineExpose({ validate, resetValidation });

onMounted(loadProducts);
</script>
