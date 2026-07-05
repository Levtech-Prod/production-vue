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
            :title="selectedRevisionIds.length !== 1 ? t('select_one_revision_hint') : ''"
            @click="addModalOpen = true"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('add_sub_product') }}
          </button>
        </div>
      </div>

      <!-- Context hints -->
      <p v-if="selectedRevisionIds.length === 2 && selectedSpRevs.length === 0" class="mt-2 text-xs text-blue-600">
        {{ t('two_revisions_selected_hint') }}
      </p>
      <p v-else-if="selectedSpRevs.length === 2" class="mt-2 text-xs text-violet-600">
        {{ t('sp_rev_compare_hint') }}
      </p>
      <p v-else-if="selectedSpRevs.length === 0 && selectedRevisionIds.length <= 1" class="mt-2 text-xs text-slate-400">
        {{ t('sp_rev_select_hint') }}
      </p>

      <!-- Main grid: sub-product table + side panel -->
      <div class="mt-4 grid gap-4 lg:grid-cols-[32rem_1fr]">
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
                    <div class="truncate font-semibold text-slate-800">{{ sp.name }}</div>
                    <div class="truncate font-mono text-xs text-slate-400">{{ sp.sku }}</div>
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

              <!-- Sub-product revision rows — clickable to select A / B -->
              <div class="mt-2 flex flex-col gap-0.5">
                <button
                  v-for="rev in sp.revisions"
                  :key="rev.id"
                  type="button"
                  class="flex items-center justify-between gap-2 rounded-r-md border-l-2 py-1 pl-2.5 pr-1.5 text-left text-sm transition-colors"
                  :class="spRevRowClass(sp, rev.id)"
                  @click="toggleSpRev(sp, rev)"
                >
                  <span class="flex items-center gap-2 truncate">
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full"
                      :class="statusDot(rev.status)"
                      :title="rev.status"
                    />
                    <span class="truncate">{{ rev.label }}</span>
                  </span>
                  <!-- A / B badge when selected, subtle arrow otherwise -->
                  <span
                    v-if="getSpRevSelectionIndex(rev.id) === 0"
                    class="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                  >A</span>
                  <span
                    v-else-if="getSpRevSelectionIndex(rev.id) === 1"
                    class="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                  >B</span>
                  <ChevronRight v-else class="h-3.5 w-3.5 shrink-0 text-slate-300" />
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- ── Right side panel ───────────────────────────────────────── -->
        <aside
          v-if="panelOpen"
          class="card flex max-h-[70vh] flex-col overflow-hidden"
        >
          <!-- Panel header -->
          <div class="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div class="min-w-0 flex-1">

              <!-- Parts comparison header (2 sp revisions selected) -->
              <template v-if="spRevCompareMode">
                <h3 class="font-semibold text-slate-700">{{ t('parts_comparison') }}</h3>
                <div class="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    v-if="compareMode"
                    type="button"
                    class="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                    @click="selectedSpRevs = []"
                  >
                    <ChevronLeft class="h-3 w-3" />{{ t('back_to_comparison') }}
                  </button>
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                  >
                    <span class="font-bold">A</span> {{ selectedSpRevs[0].revLabel }}
                  </span>
                  <span class="text-xs text-slate-300">vs</span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                  >
                    <span class="font-bold">B</span> {{ selectedSpRevs[1].revLabel }}
                  </span>
                  <span class="truncate text-xs text-slate-400">· {{ selectedSpRevs[0].spName }}</span>
                </div>
              </template>

              <!-- Single revision parts header -->
              <template v-else-if="spRevSingleMode">
                <h3 class="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                  <span class="truncate">
                    {{ t('parts_of', { name: selectedSpRevs[0].spName }) }}
                  </span>
                  <span
                    class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                  >
                    {{ selectedSpRevs[0].revLabel }}
                  </span>
                </h3>
              </template>

              <!-- Product revision comparison header -->
              <template v-else>
                <h3 class="font-semibold text-slate-700">{{ t('comparison') }}</h3>
                <div class="mt-1.5 flex flex-wrap items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                  >
                    <span class="font-bold">A</span> {{ revisionLabel(selectedRevisionIds[0]) }}
                  </span>
                  <span class="text-xs text-slate-300">vs</span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                  >
                    <span class="font-bold">B</span> {{ revisionLabel(selectedRevisionIds[1]) }}
                  </span>
                </div>
              </template>
            </div>

            <button
              type="button"
              class="mt-0.5 shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              @click="closePanel"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- ── Parts comparison content ─────────────────────────────── -->
          <div v-if="spRevCompareMode" class="flex-1 overflow-y-auto">
            <div v-if="comparePartsLoading" class="py-8 text-center text-sm text-slate-400">
              {{ t('loading') }}
            </div>
            <template v-else-if="comparePartsResult">
              <!-- Summary bar -->
              <div
                v-if="comparePartsSummary"
                class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs"
              >
                <span v-if="comparePartsSummary.added" class="font-medium text-emerald-700">
                  +{{ comparePartsSummary.added }} {{ t('compare_status.added').toLowerCase() }}
                </span>
                <span v-if="comparePartsSummary.changed" class="font-medium text-amber-700">
                  ~{{ comparePartsSummary.changed }} {{ t('compare_status.changed').toLowerCase() }}
                </span>
                <span v-if="comparePartsSummary.removed" class="font-medium text-red-700">
                  −{{ comparePartsSummary.removed }} {{ t('compare_status.removed').toLowerCase() }}
                </span>
                <span class="text-slate-400">
                  {{ comparePartsSummary.unchanged }} {{ t('compare_status.unchanged').toLowerCase() }}
                </span>
              </div>

              <!-- Empty -->
              <div
                v-if="comparePartsResult.parts.length === 0"
                class="py-8 text-center text-sm text-slate-400"
              >
                {{ t('no_parts_in_revision') }}
              </div>

              <template v-else>
                <!-- Column headers -->
                <div class="grid items-end gap-2 border-b border-slate-100 px-4 py-2" style="grid-template-columns: 1fr 5rem 5rem">
                  <span class="text-xs font-medium uppercase tracking-wide text-slate-400">{{ t('part') }}</span>
                  <div class="text-right">
                    <div class="text-xs font-semibold text-blue-500">A</div>
                    <div class="truncate text-[10px] text-blue-400">{{ selectedSpRevs[0].revLabel }}</div>
                  </div>
                  <div class="text-right">
                    <div class="text-xs font-semibold text-emerald-600">B</div>
                    <div class="truncate text-[10px] text-emerald-500">{{ selectedSpRevs[1].revLabel }}</div>
                  </div>
                </div>

                <!-- Rows -->
                <ul class="divide-y divide-slate-100">
                  <li
                    v-for="row in comparePartsResult.parts"
                    :key="row.partId"
                    class="grid items-center gap-2 px-4 py-2.5"
                    style="grid-template-columns: 1fr 5rem 5rem"
                    :class="comparePartRowBg(row.status)"
                  >
                    <!-- Part name + thumbnail -->
                    <div class="flex min-w-0 items-center gap-2.5">
                      <img
                        v-if="row.image"
                        :src="row.image"
                        class="h-8 w-8 shrink-0 rounded-md border border-slate-100 object-cover"
                        :alt="row.name"
                      />
                      <div
                        v-else
                        class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] text-slate-300"
                      >
                        ▣
                      </div>
                      <div class="min-w-0">
                        <div class="truncate text-sm font-medium text-slate-800">{{ row.name }}</div>
                        <div class="truncate font-mono text-xs text-slate-400">{{ row.code }}</div>
                      </div>
                    </div>

                    <!-- A quantity -->
                    <div class="text-right text-sm tabular-nums" :class="partQtyClassA(row)">
                      {{ row.inA ? `${row.inA.quantity}${row.inA.unit ? ' ' + row.inA.unit : ''}` : '—' }}
                    </div>

                    <!-- B quantity -->
                    <div class="text-right text-sm tabular-nums" :class="partQtyClassB(row)">
                      {{ row.inB ? `${row.inB.quantity}${row.inB.unit ? ' ' + row.inB.unit : ''}` : '—' }}
                    </div>
                  </li>
                </ul>
              </template>
            </template>
          </div>

          <!-- ── Single revision parts content ───────────────────────── -->
          <div v-else-if="spRevSingleMode" class="flex-1 overflow-y-auto">
            <div v-if="partsLoading" class="py-8 text-center text-sm text-slate-400">
              {{ t('loading') }}
            </div>
            <div v-else-if="parts.length === 0" class="py-8 text-center text-sm text-slate-400">
              {{ t('no_parts_in_revision') }}
            </div>
            <template v-else>
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
                      <div class="truncate text-sm font-medium text-slate-800">{{ part.name }}</div>
                      <div class="truncate font-mono text-xs text-slate-400">{{ part.code }}</div>
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

          <!-- ── Product revision comparison content ─────────────────── -->
          <div v-else class="flex-1 overflow-y-auto">
            <div v-if="compareLoading" class="py-8 text-center text-sm text-slate-400">
              {{ t('loading') }}
            </div>
            <ul v-else-if="compareResult" class="flex flex-col gap-2 p-4">
              <li
                v-for="row in compareResult.subProducts"
                :key="row.subProductId"
                class="rounded-lg border px-3 py-2.5"
                :class="compareRowClass(row.status)"
              >
                <!-- Name + status chip -->
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-slate-800">{{ row.name }}</div>
                    <div class="font-mono text-xs text-slate-400">{{ row.sku }}</div>
                  </div>
                  <span
                    class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    :class="compareSubProductStatusChipClass(row.status)"
                  >
                    {{ t('compare_status.' + row.status) }}
                  </span>
                </div>

                <!-- A / B revision labels + action button -->
                <div class="mt-2 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-3 text-xs">
                    <span
                      :class="row.inA ? 'font-medium text-blue-600' : 'text-slate-400'"
                    >A: {{ row.inA ? row.inA.revisionLabel : '—' }}</span>
                    <span class="text-slate-300">·</span>
                    <span
                      :class="row.inB ? 'font-medium text-emerald-600' : 'text-slate-400'"
                    >B: {{ row.inB ? row.inB.revisionLabel : '—' }}</span>
                  </div>

                  <!-- Drill-in actions -->
                  <button
                    v-if="row.status === 'changed'"
                    type="button"
                    class="inline-flex shrink-0 items-center gap-0.5 rounded-md px-2 py-0.5 text-xs text-slate-500 hover:bg-white/70 hover:text-blue-600"
                    @click="comparePartsFromProductCompare(row)"
                  >
                    {{ t('compare_parts') }}
                    <ChevronRight class="h-3 w-3" />
                  </button>
                  <button
                    v-else-if="(row.status === 'unchanged' || row.status === 'added' || row.status === 'removed') && (row.inA || row.inB)"
                    type="button"
                    class="inline-flex shrink-0 items-center gap-0.5 rounded-md px-2 py-0.5 text-xs text-slate-500 hover:bg-white/70 hover:text-blue-600"
                    @click="viewPartsFromProductCompare(row)"
                  >
                    {{ t('view_parts') }}
                    <ChevronRight class="h-3 w-3" />
                  </button>
                </div>
              </li>
            </ul>
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
  SubProductRevision,
  RevisionPart,
  CompareResult,
  CompareSubProduct,
  ComparePartsResult,
  CompareStatus,
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

// ---- Product revision selection (max 2) ----
const selectedRevisionIds = ref<number[]>([]);

function toggleRevision(id: number) {
  const idx = selectedRevisionIds.value.indexOf(id);
  if (idx !== -1) {
    selectedRevisionIds.value.splice(idx, 1);
  } else if (selectedRevisionIds.value.length < 2) {
    selectedRevisionIds.value.push(id);
  } else {
    selectedRevisionIds.value = [selectedRevisionIds.value[1], id];
  }
}

function revisionLabel(revId: number): string {
  return detail.value?.revisions.find((r) => r.id === revId)?.label ?? '—';
}

// productRevisionId -> subProductRevisionId[]
const membership = computed<Record<number, number[]>>(() => {
  const map: Record<number, number[]> = {};
  for (const m of detail.value?.membership ?? []) {
    (map[m.productRevisionId] ??= []).push(m.subProductRevisionId);
  }
  return map;
});

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
  return (
    {
      draft: 'bg-slate-400',
      active: 'bg-emerald-500',
      deprecated: 'bg-amber-500',
    }[status] ?? 'bg-slate-400'
  );
}

// ---- Sub-product revision selection (max 2, for parts compare) ----
interface SpRevSelection {
  spId: number;
  revId: number;
  spName: string;
  revLabel: string;
}
const selectedSpRevs = ref<SpRevSelection[]>([]);

const spRevCompareMode = computed(() => selectedSpRevs.value.length === 2);
const spRevSingleMode = computed(() => selectedSpRevs.value.length === 1);

function getSpRevSelectionIndex(revId: number): number {
  return selectedSpRevs.value.findIndex((s) => s.revId === revId);
}

function toggleSpRev(sp: DetailSubProduct, rev: SubProductRevision) {
  const idx = getSpRevSelectionIndex(rev.id);
  if (idx !== -1) {
    // Already selected — deselect it
    selectedSpRevs.value.splice(idx, 1);
  } else if (selectedSpRevs.value.length < 2) {
    selectedSpRevs.value.push({
      spId: sp.id,
      revId: rev.id,
      spName: sp.name,
      revLabel: rev.label,
    });
  } else {
    // Replace oldest selection
    selectedSpRevs.value = [
      selectedSpRevs.value[1],
      { spId: sp.id, revId: rev.id, spName: sp.name, revLabel: rev.label },
    ];
  }
}

// Row style: selection state takes priority over membership highlighting
function spRevRowClass(sp: DetailSubProduct, spRevId: number): string {
  const selIdx = getSpRevSelectionIndex(spRevId);
  if (selIdx === 0) return 'border-blue-500 bg-blue-50 text-blue-700';
  if (selIdx === 1) return 'border-emerald-500 bg-emerald-50 text-emerald-700';
  // Membership highlight (which product revision contains this sp revision)
  const inA = setA.value.has(spRevId);
  const inB = setB.value.has(spRevId);
  if (inA && inB) return 'border-violet-400 bg-violet-50/60';
  if (inA) return 'border-blue-400 bg-blue-50/60';
  if (inB) return 'border-emerald-400 bg-emerald-50/60';
  return 'border-transparent text-slate-600 hover:bg-slate-50';
}

// ---- Single parts list ----
const parts = ref<RevisionPart[]>([]);
const partsLoading = ref(false);

async function loadSingleParts(sel: SpRevSelection) {
  partsLoading.value = true;
  parts.value = [];
  try {
    const response = await subProductsApi.getRevisionParts(sel.spId, sel.revId);
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

// ---- Parts comparison (2 sp revisions) ----
const comparePartsResult = ref<ComparePartsResult | null>(null);
const comparePartsLoading = ref(false);

const comparePartsSummary = computed(() => {
  if (!comparePartsResult.value) return null;
  const p = comparePartsResult.value.parts;
  return {
    added: p.filter((r) => r.status === 'added').length,
    removed: p.filter((r) => r.status === 'removed').length,
    changed: p.filter((r) => r.status === 'changed').length,
    unchanged: p.filter((r) => r.status === 'unchanged').length,
  };
});

watch(
  selectedSpRevs,
  async (selections) => {
    comparePartsResult.value = null;
    parts.value = [];
    if (selections.length === 2) {
      comparePartsLoading.value = true;
      try {
        const res = await subProductsApi.compareRevisionParts(
          selections[0].revId,
          selections[1].revId,
        );
        comparePartsResult.value = res.data;
      } catch (err: any) {
        notify.showToast(
          translateApiError(err, { t, te }, 'errors.load_parts_failed'),
          'error',
        );
      } finally {
        comparePartsLoading.value = false;
      }
    } else if (selections.length === 1) {
      await loadSingleParts(selections[0]);
    }
  },
  { deep: true },
);

// ---- Compare mode (2 product revisions selected) ----
const compareMode = computed(() => selectedRevisionIds.value.length === 2);
const compareResult = ref<CompareResult | null>(null);
const compareLoading = ref(false);

watch(
  selectedRevisionIds,
  async (ids) => {
    if (ids.length === 2) {
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

// ---- Navigate from product compare into parts compare ----
function comparePartsFromProductCompare(row: CompareSubProduct) {
  if (!row.inA || !row.inB) return;
  selectedSpRevs.value = [
    {
      spId: row.subProductId,
      revId: row.inA.subProductRevisionId,
      spName: row.name,
      revLabel: row.inA.revisionLabel,
    },
    {
      spId: row.subProductId,
      revId: row.inB.subProductRevisionId,
      spName: row.name,
      revLabel: row.inB.revisionLabel,
    },
  ];
}

function viewPartsFromProductCompare(row: CompareSubProduct) {
  const side = row.inB ?? row.inA;
  if (!side) return;
  selectedSpRevs.value = [
    {
      spId: row.subProductId,
      revId: side.subProductRevisionId,
      spName: row.name,
      revLabel: side.revisionLabel,
    },
  ];
}

// ---- Panel open / close ----
const panelOpen = computed(
  () => selectedSpRevs.value.length > 0 || compareMode.value,
);

function closePanel() {
  if (selectedSpRevs.value.length > 0) {
    selectedSpRevs.value = [];
  } else if (compareMode.value) {
    selectedRevisionIds.value = selectedRevisionIds.value.slice(0, 1);
  }
}

// ---- Comparison row styling ----
function compareRowClass(status: string): string {
  return (
    {
      added: 'border-emerald-200 bg-emerald-50',
      removed: 'border-red-200 bg-red-50',
      changed: 'border-amber-200 bg-amber-50',
      unchanged: 'border-slate-200 bg-white',
    }[status] ?? 'border-slate-200'
  );
}

function compareSubProductStatusChipClass(status: CompareStatus): string {
  return (
    {
      added: 'bg-emerald-100 text-emerald-700',
      removed: 'bg-red-100 text-red-700',
      changed: 'bg-amber-100 text-amber-700',
      unchanged: 'bg-slate-100 text-slate-500',
    }[status] ?? 'bg-slate-100 text-slate-500'
  );
}

// Row background tint — no borders, just a very subtle wash
function comparePartRowBg(status: CompareStatus): string {
  return (
    {
      added: 'bg-emerald-50/50',
      removed: 'bg-red-50/50',
      changed: 'bg-amber-50/40',
      unchanged: '',
    }[status] ?? ''
  );
}

// A column: muted when value is absent or overridden; accent color when it's the "loss" side
function partQtyClassA(row: { inA: unknown; status: CompareStatus }): string {
  if (!row.inA) return 'text-slate-300'; // absent (added in B)
  if (row.status === 'removed') return 'font-medium text-red-500';
  if (row.status === 'changed') return 'text-slate-400'; // old value, de-emphasised
  return 'text-slate-500'; // unchanged
}

// B column: accent color for new/added values; muted when absent
function partQtyClassB(row: { inB: unknown; status: CompareStatus }): string {
  if (!row.inB) return 'text-slate-300'; // absent (removed in B)
  if (row.status === 'added') return 'font-medium text-emerald-700';
  if (row.status === 'changed') return 'font-medium text-emerald-700';
  return 'text-slate-500'; // unchanged
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

const spRevToSubProduct = computed<Record<number, number>>(() => {
  const map: Record<number, number> = {};
  for (const sp of detail.value?.subProducts ?? []) {
    for (const rev of sp.revisions) map[rev.id] = sp.id;
  }
  return map;
});

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
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.update_revision_failed'),
      'error',
    );
  } finally {
    modalSaving.value = false;
  }
}

// On initial load, default to the product's default revision and auto-open
// the first sub-product revision that belongs to it.
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
      selectedSpRevs.value = [
        { spId: sp.id, revId: rev.id, spName: sp.name, revLabel: rev.label },
      ];
      break;
    }
  }
}

async function loadAndApplyDefaults() {
  await reload();
  applyDefaults();
}

onMounted(loadAndApplyDefaults);

watch(productId, () => {
  selectedRevisionIds.value = [];
  selectedSpRevs.value = [];
  loadAndApplyDefaults();
});
</script>
