<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Filter + sort. Both run over the already-loaded revision list, so
         neither triggers a request. -->
    <div
      class="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-1.5"
    >
      <select
        v-model="statusFilter"
        class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
        :aria-label="t('filter_by_status')"
      >
        <option value="all">{{ t('all_statuses') }}</option>
        <option value="draft">{{ t('revision_status.draft') }}</option>
        <option value="active">{{ t('revision_status.active') }}</option>
        <option value="deprecated">{{ t('revision_status.deprecated') }}</option>
      </select>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:border-slate-300"
        @click="newestFirstOrder = !newestFirstOrder"
      >
        <ArrowDownWideNarrow v-if="newestFirstOrder" class="h-3.5 w-3.5" />
        <ArrowUpNarrowWide v-else class="h-3.5 w-3.5" />
        {{ newestFirstOrder ? t('sort_newest') : t('sort_oldest') }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
      <p
        v-if="!detail.revisions.length"
        class="py-10 text-center text-sm text-slate-400"
      >
        {{ t('no_revisions_yet') }}
      </p>
      <p
        v-else-if="!visibleRevisions.length"
        class="py-10 text-center text-sm text-slate-400"
      >
        {{ t('no_revisions_for_filter') }}
      </p>
      <ul v-else>
        <RevisionTimelineItem
          v-for="(rev, i) in visibleRevisions"
          :key="rev.id"
          :revision="rev"
          :is-active="rev.id === activeProductRevId"
          :is-default="rev.id === detail.defaultRevisionId"
          :is-last="i === visibleRevisions.length - 1"
          @select="emit('set-active-rev', rev.id)"
        />
      </ul>
    </div>

    <div v-if="!isArchived" class="shrink-0 border-t border-slate-100 p-2">
      <button
        type="button"
        class="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-blue-600"
        :disabled="!detail.subProducts.length"
        :title="!detail.subProducts.length ? t('add_new_revision_disabled_hint') : ''"
        @click="emit('start-new-revision')"
      >
        <Plus class="h-3.5 w-3.5" /> {{ t('add_new_revision') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import RevisionTimelineItem from './RevisionTimelineItem.vue';
import { pinnedOrder } from '../revisionHelpers.ts';
import type { ProductDetail, RevisionStatus } from '../../../../types/products.ts';

const props = defineProps<{
  detail: ProductDetail;
  activeProductRevId: number | null;
  isArchived: boolean;
}>();

const emit = defineEmits<{
  (e: 'set-active-rev', revId: number): void;
  (e: 'start-new-revision'): void;
}>();

const { t } = useI18n();

const statusFilter = ref<RevisionStatus | 'all'>('all');
const newestFirstOrder = ref(true);

const visibleRevisions = computed(() => {
  const ordered = pinnedOrder(
    props.detail.revisions,
    props.detail.defaultRevisionId,
    newestFirstOrder.value,
  );
  return statusFilter.value === 'all'
    ? ordered
    : ordered.filter((r) => r.status === statusFilter.value);
});
</script>
