<template>
  <div class="flex min-h-0 flex-col border-r border-slate-100">
    <div class="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-1.5">
      <span class="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {{ t('version_list') }}
      </span>
      <!-- Runs over the already-loaded list, so it triggers no request. -->
      <select
        v-model="statusFilter"
        class="min-w-0 shrink rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
        :aria-label="t('filter_by_status')"
      >
        <option value="all">{{ t('all_statuses') }}</option>
        <option v-for="status in DOCUMENT_REVISION_STATUSES" :key="status" :value="status">
          {{ t(`version_status.${status}`) }}
        </option>
      </select>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
      <p v-if="loading" class="py-10 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </p>
      <p v-else-if="!revisions.length" class="py-10 text-center text-sm text-slate-400">
        {{ t('no_versions_yet') }}
      </p>
      <p v-else-if="!visible.length" class="py-10 text-center text-sm text-slate-400">
        {{ t('no_version_for_filter') }}
      </p>
      <ul v-else>
        <DocumentRevisionListItem
          v-for="(revision, i) in visible"
          :key="revision.id"
          :revision="revision"
          :is-selected="revision.id === selectedId"
          :is-last="i === visible.length - 1"
          @select="emit('select', revision.id)"
        />
      </ul>
    </div>

    <div v-if="canEdit" class="shrink-0 border-t border-slate-100 p-2">
      <button
        type="button"
        class="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        @click="emit('create')"
      >
        <Plus class="h-3.5 w-3.5" /> {{ t('add_version') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import DocumentRevisionListItem from './DocumentRevisionListItem.vue';
import { DOCUMENT_REVISION_STATUSES } from '../../../../../types/documentRevisions.ts';
import type {
  DocumentRevision,
  DocumentRevisionStatus,
} from '../../../../../types/documentRevisions.ts';

const props = defineProps<{
  revisions: DocumentRevision[];
  selectedId: number | null;
  loading: boolean;
  canEdit: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', revisionId: number): void;
  (e: 'create'): void;
}>();

const { t } = useI18n();

const statusFilter = ref<DocumentRevisionStatus | 'all'>('all');

// The list arrives newest-first from the API; only filtering happens here.
const visible = computed(() =>
  statusFilter.value === 'all'
    ? props.revisions
    : props.revisions.filter((r) => r.status === statusFilter.value),
);
</script>
