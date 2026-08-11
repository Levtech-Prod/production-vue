<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <!-- Identity -->
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-lg font-semibold text-slate-800">{{ title }}</h3>
      <span
        v-if="revision"
        class="rounded-full px-2 py-0.5 text-xs font-medium"
        :class="statusBadgeClass(revision.status)"
      >
        {{ t(`revision_status.${revision.status}`) }}
      </span>
      <span
        v-if="isDefault"
        class="inline-flex items-center gap-1 text-xs font-medium text-amber-600"
      >
        <Star class="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
        {{ t('default_revision') }}
      </span>

      <button
        v-if="revision && !isArchived"
        type="button"
        class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800"
        @click="onEdit"
      >
        <Pencil class="h-3.5 w-3.5" /> {{ t('edit_revision') }}
      </button>
    </div>
    <p v-if="subtitle" class="mt-0.5 font-mono text-xs text-slate-400">
      {{ subtitle }}
    </p>

    <p v-if="!revision" class="mt-6 text-sm text-slate-400">
      {{ t('no_revision_selected') }}
    </p>

    <template v-else>
      <!-- Facts -->
      <dl class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-lg bg-slate-50 px-3 py-2">
          <dt class="text-[11px] uppercase tracking-wide text-slate-400">
            {{ t('created_at') }}
          </dt>
          <dd class="mt-0.5 text-sm font-semibold text-slate-800">
            {{ formatDate(revision.createdAt) }}
          </dd>
        </div>
        <div class="rounded-lg bg-slate-50 px-3 py-2">
          <dt class="text-[11px] uppercase tracking-wide text-slate-400">
            {{ t('created_by') }}
          </dt>
          <dd class="mt-0.5 truncate text-sm font-semibold text-slate-800">
            {{ createdByName }}
          </dd>
        </div>
        <div v-if="isProductScope" class="rounded-lg bg-slate-50 px-3 py-2">
          <dt class="text-[11px] uppercase tracking-wide text-slate-400">
            {{ t('sub_products') }}
          </dt>
          <dd class="mt-0.5 text-sm font-semibold text-slate-800">
            {{ composition.length }}
          </dd>
        </div>
        <div class="rounded-lg bg-slate-50 px-3 py-2">
          <dt class="text-[11px] uppercase tracking-wide text-slate-400">
            {{ t('tab_documents') }}
          </dt>
          <dd class="mt-0.5 text-sm font-semibold text-slate-800">
            {{
              t('documents_progress', {
                done: docsSummary.uploaded,
                total: docsSummary.totalTypes,
              })
            }}
          </dd>
        </div>
      </dl>

      <!-- Change notes -->
      <h4 class="mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {{ t('change_notes') }}
      </h4>
      <p
        v-if="revision.changeNotes"
        class="mt-1.5 whitespace-pre-line rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600"
      >
        {{ revision.changeNotes }}
      </p>
      <p v-else class="mt-1.5 text-sm text-slate-400">{{ t('no_change_notes') }}</p>

      <!-- Composition. Rows select the sub-product revision, which is what
           scopes the Documents and BOM tabs. -->
      <template v-if="isProductScope">
        <h4 class="mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {{ t('revision_composition') }}
        </h4>
        <p v-if="!composition.length" class="mt-1.5 text-sm text-slate-400">
          {{ t('no_linked_sub_products') }}
        </p>
        <ul v-else class="mt-1.5 divide-y divide-slate-100">
          <li v-for="row in composition" :key="row.sp.id">
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50"
              @click="
                emit('select', {
                  type: 'subProduct',
                  spId: row.sp.id,
                  spRevId: row.rev.id,
                })
              "
            >
              <img
                v-if="row.sp.image"
                :src="row.sp.image"
                class="h-8 w-8 shrink-0 rounded-lg border border-slate-200 object-cover"
                :alt="row.sp.name"
              />
              <span
                v-else
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
                aria-hidden="true"
              >
                ▣
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-slate-800">
                  {{ row.sp.name }}
                </span>
                <span class="block truncate font-mono text-xs text-slate-400">
                  {{ row.sp.sku || '—' }}
                </span>
              </span>
              <span
                class="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
                :title="t('linked_revision')"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="statusDot(row.rev.status)"
                  aria-hidden="true"
                />
                {{ row.rev.label }}
              </span>
            </button>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, Star } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatDate } from '../../../utils/formatters.ts';
import { linkedRevOf, statusBadgeClass, statusDot } from './revisionHelpers.ts';
import type {
  DetailSubProduct,
  ProductDetail,
  ProductRevision,
  RevisionDocuments,
  SubProductRevision,
} from '../../../types/products.ts';
import type { Selection } from './types.ts';

const props = defineProps<{
  detail: ProductDetail;
  activeProductRevId: number | null;
  selection: Selection;
  membershipMap: Map<number, Set<number>>;
  docsSummary: RevisionDocuments['summary'];
  isArchived: boolean;
}>();

// Edit emits mirror the tree's names and payloads, so both entry points land on
// the same handlers in ProductDetailView rather than growing a second path.
const emit = defineEmits<{
  (e: 'select', sel: Selection): void;
  (e: 'edit-product-rev', rev: ProductRevision): void;
  (e: 'edit-sp-revision', sp: DetailSubProduct, rev: SubProductRevision): void;
}>();

const { t } = useI18n();

const isProductScope = computed(() => props.selection.type === 'product');

/** Edit whichever revision the panel is currently describing. */
function onEdit() {
  if (!isProductScope.value) {
    const target = selectedSubProduct.value;
    if (target) emit('edit-sp-revision', target.sp, target.rev);
    return;
  }
  const rev = props.detail.revisions.find(
    (r) => r.id === props.activeProductRevId,
  );
  if (rev) emit('edit-product-rev', rev);
}

/** The sub-product the selection points at, when it points at one. */
const selectedSubProduct = computed(() => {
  const sel = props.selection;
  if (sel.type !== 'subProduct') return null;
  const sp = props.detail.subProducts.find((s) => s.id === sel.spId);
  const rev = sp?.revisions.find((r) => r.id === sel.spRevId);
  return sp && rev ? { sp, rev } : null;
});

/** Product revision when the product is selected, sub-product revision
 *  otherwise — the panel describes whatever the rest of the page is scoped to. */
const revision = computed<ProductRevision | SubProductRevision | null>(() => {
  if (!isProductScope.value) return selectedSubProduct.value?.rev ?? null;
  return (
    props.detail.revisions.find((r) => r.id === props.activeProductRevId) ?? null
  );
});

const title = computed(() => {
  if (!isProductScope.value) return selectedSubProduct.value?.sp.name ?? '—';
  return revision.value?.label ?? props.detail.name;
});

const subtitle = computed(() => {
  if (!isProductScope.value) return selectedSubProduct.value?.rev.label ?? '';
  return props.detail.sku;
});

const isDefault = computed(
  () =>
    isProductScope.value &&
    revision.value != null &&
    revision.value.id === props.detail.defaultRevisionId,
);

// Only product revisions carry an author today — sub-product revisions have the
// column but nothing writes it yet, so they always render as unknown.
const createdByName = computed(() =>
  isProductScope.value
    ? ((revision.value as ProductRevision | null)?.createdByName ?? '—')
    : '—',
);

const composition = computed<{ sp: DetailSubProduct; rev: SubProductRevision }[]>(
  () =>
    props.detail.subProducts
      .map((sp) => ({
        sp,
        rev: linkedRevOf(sp, props.membershipMap, props.activeProductRevId),
      }))
      .filter(
        (row): row is { sp: DetailSubProduct; rev: SubProductRevision } =>
          row.rev != null,
      ),
);
</script>
