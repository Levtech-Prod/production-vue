<template>
  <div class="flex-1 overflow-y-auto min-h-0">
    <!-- Loading -->
    <div
      v-if="loading"
      class="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"
    >
      <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      {{ t('loading') }}
    </div>

    <table v-else class="w-full text-left text-sm">
      <thead class="bg-blue-50 text-xs uppercase text-black sticky top-0 z-10">
        <tr>
          <th class="p-4">{{ t('action') }}</th>
          <th class="p-4">{{ t('field') }}</th>
          <th class="p-4">{{ t('old_value') }}</th>
          <th class="p-4">{{ t('new_value') }}</th>
          <th class="p-4">{{ t('changed_by') }}</th>
          <th class="p-4">{{ t('date') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="displayLogs.length === 0">
          <td colspan="6" class="py-12 text-center text-sm text-slate-400">
            {{ t('no_change_log') }}
          </td>
        </tr>

        <template v-for="entry in displayLogs" :key="entry.log.id">
          <tr
            v-for="(row, idx) in entry.rows"
            :key="entry.log.id + '-' + idx"
            class="border-t border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <!-- Action badge (spans the group) -->
            <td v-if="idx === 0" :rowspan="entry.rows.length" class="p-4 align-top">
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                :class="actionClass(entry.log.action)"
              >
                {{ t(entry.log.action) }}
              </span>
            </td>

            <!-- Field -->
            <td class="p-4 text-slate-700">{{ row.field }}</td>

            <!-- Old value -->
            <td class="p-4">
              <span
                v-if="row.old"
                class="inline-block rounded px-1.5 py-0.5"
                :class="row.highlight ? 'bg-red-50 text-red-700' : 'text-slate-600'"
              >
                {{ row.old }}
              </span>
              <span v-else class="text-slate-300">—</span>
            </td>

            <!-- New value -->
            <td class="p-4">
              <span
                v-if="row.new"
                class="inline-block rounded px-1.5 py-0.5"
                :class="row.highlight ? 'bg-green-50 text-green-700' : 'text-slate-600'"
              >
                {{ row.new }}
              </span>
              <span v-else class="text-slate-300">—</span>
            </td>

            <!-- By (spans the group) -->
            <td v-if="idx === 0" :rowspan="entry.rows.length" class="p-4 align-top text-slate-500">
              {{ entry.log.actorName || '—' }}
            </td>

            <!-- When (spans the group) -->
            <td
              v-if="idx === 0"
              :rowspan="entry.rows.length"
              class="p-4 align-top text-slate-500 whitespace-nowrap"
            >
              {{ formatDate(entry.log.createdAt) }}
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useAuditLogsStore } from '../stores/auditLogsStore.ts';
import { fieldLabelKey } from '../utils/auditFieldLabels.ts';
import { formatDate } from '../utils/formatters.ts';
import type { AuditAction, AuditChanges, AuditLog } from '../types/auditLogs.ts';

const props = defineProps<{
  entityType: string;
  entityId: number;
}>();

const { t } = useI18n();
const store = useAuditLogsStore();
const { loadingKey } = storeToRefs(store);

const logs = computed<AuditLog[]>(() => store.getLogs(props.entityType, props.entityId));
const loading = computed(() => store.isLoading(props.entityType, props.entityId));
// Touch loadingKey so `loading` stays reactive across store updates.
void loadingKey;

// Always fetch fresh when shown or when the entity changes — the log must
// reflect the edit the user just made.
onMounted(() => store.loadLogs(props.entityType, props.entityId));
watch(
  () => props.entityId,
  (id) => store.loadLogs(props.entityType, id),
);

// ── Flatten each log into one or more table rows ──────────────────────────────

interface DisplayRow {
  field: string;
  old: string;
  new: string;
  highlight: boolean;
}

function actionClass(action: AuditAction): string {
  switch (action) {
    case 'created':
      return 'bg-green-50 text-green-700';
    case 'deleted':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-amber-50 text-amber-700';
  }
}

function label(field: string): string {
  const key = fieldLabelKey(props.entityType, field);
  return t(key);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('amount' in o && 'currency' in o) return `${o.amount} ${o.currency}`;
    return JSON.stringify(o);
  }
  return String(v);
}

function snapshotSummary(snapshot: Record<string, unknown> | undefined): string {
  if (!snapshot) return '';
  const parts: string[] = [];
  if (snapshot.name) parts.push(String(snapshot.name));
  if (snapshot.code) parts.push(`(${snapshot.code})`);
  if (snapshot.category) parts.push(`· ${snapshot.category}`);
  return parts.join(' ');
}

function rowsFor(action: AuditAction, changes: AuditChanges): DisplayRow[] {
  if (action === 'created') {
    return [{ field: '—', old: '', new: snapshotSummary(changes.snapshot), highlight: false }];
  }
  if (action === 'deleted') {
    return [{ field: '—', old: snapshotSummary(changes.snapshot), new: '', highlight: false }];
  }

  const rows: DisplayRow[] = [];
  for (const [key, change] of Object.entries(changes.fields ?? {})) {
    rows.push({
      field: label(key),
      old: formatValue(change.from),
      new: formatValue(change.to),
      highlight: true,
    });
  }
  const params = changes.parameters;
  if (params) {
    for (const p of params.added) rows.push({ field: p.name, old: '', new: p.value, highlight: true });
    for (const p of params.changed) rows.push({ field: p.name, old: p.from, new: p.to, highlight: true });
    for (const p of params.removed) rows.push({ field: p.name, old: p.value, new: '', highlight: true });
  }
  if (rows.length === 0) {
    rows.push({ field: '—', old: '', new: '', highlight: false });
  }
  return rows;
}

const displayLogs = computed(() =>
  logs.value.map((log) => ({ log, rows: rowsFor(log.action, log.changes) })),
);
</script>
