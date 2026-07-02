<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-3xl font-bold">{{ t('products') }}</h1>
    </div>

    <div class="card mt-6 overflow-hidden">
      <!-- Toolbar -->
      <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div class="relative max-w-sm flex-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clip-rule="evenodd"
            />
          </svg>
          <input
            v-model="search"
            class="input !pl-9"
            :placeholder="t('search_products_placeholder')"
          />
        </div>

        <span class="text-sm text-slate-400">
          {{ filtered.length }} / {{ products.length }}
        </span>

        <button
          class="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
          @click="openAdd"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
              clip-rule="evenodd"
            />
          </svg>
          {{ t('add_product') }}
        </button>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-4">{{ t('image') }}</th>
            <th class="p-4">SKU</th>
            <th class="p-4">{{ t('name') }}</th>
            <th class="p-4">{{ t('type') }}</th>
            <th class="p-4">{{ t('revisions') }}</th>
            <th class="p-4">{{ t('actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="6" class="py-12 text-center text-sm text-slate-400">
              <template v-if="search">{{ t('no_search_results') }}.</template>
              <template v-else>{{ t('no_products_msg') }}</template>
            </td>
          </tr>
          <tr
            v-for="product in filtered"
            :key="product.id"
            class="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50"
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
                />
                <span v-if="!product.revisions.length" class="text-slate-300">—</span>
              </div>
            </td>
            <td class="p-4" @click.stop>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                  :title="t('edit')"
                  @click="openEdit(product)"
                >
                  <Pencil class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  :title="t('open')"
                  @click="openDetail(product.id)"
                >
                  <ChevronRight class="h-4 w-4" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Pencil, ChevronRight } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import ProductModal from './ProductModal.vue';
import RevisionChip from './RevisionChip.vue';
import { useProductsStore } from '../../stores/productsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import type { ProductSummary, ProductPayload } from '../../types/products.ts';

const { t, te } = useI18n();
const router = useRouter();
const store = useProductsStore();
const notify = useNotificationStore();

const products = computed(() => store.list);
const search = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return products.value;
  return products.value.filter(
    (p) =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
  );
});

const modalOpen = ref(false);
const editing = ref<ProductSummary | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);

function openAdd() {
  editing.value = null;
  saveError.value = null;
  modalOpen.value = true;
}

function openEdit(product: ProductSummary) {
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

onMounted(() => {
  store.fetchList();
});
</script>
