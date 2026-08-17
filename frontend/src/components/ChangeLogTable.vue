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
      <thead class="table-head text-xs sticky top-0 z-10">
        <tr>
          <th class="p-4">{{ t('action') }}</th>
          <th class="p-4">{{ t('field') }}</th>
          <th class="p-4">{{ t('where') }}</th>
          <th class="p-4">{{ t('old_value') }}</th>
          <th class="p-4">{{ t('new_value') }}</th>
          <th class="p-4">{{ t('changed_by') }}</th>
          <th class="p-4">{{ t('date') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="displayLogs.length === 0">
          <td colspan="7" class="py-12 text-center text-sm text-slate-400">
            {{ t('no_change_log') }}
          </td>
        </tr>

        <template v-for="entry in displayLogs" :key="entry.log.id">
          <tr
            v-for="(row, idx) in entry.rows"
            :key="entry.log.id + '-' + idx"
            class="border-t border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <!-- Action — per row, reflecting what happened -->
            <td class="p-4">
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                :class="actionClass(row.actionKey)"
              >
                {{ t(actionKeyLabel(row.actionKey)) }}
              </span>
            </td>

            <!-- Field (name of what changed) -->
            <td class="p-4 text-slate-700">{{ row.field }}</td>

            <!-- Where (location of the change within the entity) -->
            <td class="p-4 text-slate-500">
              <span v-if="row.where">{{ row.where }}</span>
              <span v-else class="text-slate-300">—</span>
            </td>

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
import type { AuditAction, AuditChanges, AuditEvent, AuditLog, AuditScope } from '../types/auditLogs.ts';

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

// Per-row action shown in the Action column. Additions -> 'added', removals ->
// 'removed', any modification -> 'updated'; whole-record create/delete keep
// their own labels.
type ActionKey = 'created' | 'updated' | 'deleted' | 'added' | 'removed';

interface DisplayRow {
  actionKey: ActionKey;
  field: string;
  where: string;
  old: string;
  new: string;
  highlight: boolean;
}

function actionClass(key: ActionKey): string {
  switch (key) {
    case 'created':
    case 'added':
      return 'bg-green-50 text-green-700';
    case 'deleted':
    case 'removed':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-amber-50 text-amber-700';
  }
}

function actionKeyLabel(key: ActionKey): string {
  if (key === 'added') return 'action_added';
  if (key === 'removed') return 'action_removed';
  if (key === 'created' || key === 'deleted') return key;
  return 'updated'; // default / unknown
}

// A parameter/event delta tag -> a row action ('changed' reads as 'updated').
function tagAction(tag: 'added' | 'removed' | 'changed'): ActionKey {
  return tag === 'changed' ? 'updated' : tag;
}

// Legacy rows may lack an explicit tag — derive it from which values exist.
function deriveTag(from?: string | null, to?: string | null): 'added' | 'removed' | 'changed' {
  const hasFrom = from != null && from !== '';
  const hasTo = to != null && to !== '';
  if (hasTo && !hasFrom) return 'added';
  if (hasFrom && !hasTo) return 'removed';
  return 'changed';
}

function label(field: string): string {
  const key = fieldLabelKey(props.entityType, field);
  return t(key);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '';
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
  // code (parts) or sku (products) — whichever identifies the record.
  const identifier = snapshot.code ?? snapshot.sku;
  if (identifier) parts.push(`(${identifier})`);
  // category (parts) or type (products) as a trailing qualifier.
  const qualifier = snapshot.category ?? snapshot.type;
  if (qualifier) parts.push(`· ${qualifier}`);
  return parts.join(' ');
}

function rowsFor(action: AuditAction, changes: AuditChanges): DisplayRow[] {
  if (action === 'created') {
    return [{ actionKey: 'created', field: '—', where: '', old: '', new: snapshotSummary(changes.snapshot), highlight: false }];
  }
  if (action === 'deleted') {
    return [{ actionKey: 'deleted', field: '—', where: '', old: snapshotSummary(changes.snapshot), new: '', highlight: false }];
  }

  const rows: DisplayRow[] = [];
  for (const [key, change] of Object.entries(changes.fields ?? {})) {
    rows.push({
      actionKey: 'updated',
      field: label(key),
      where: '',
      old: formatValue(change.from),
      new: formatValue(change.to),
      highlight: true,
    });
  }
  for (const ev of changes.events ?? []) {
    rows.push(eventRow(ev));
  }
  if (rows.length === 0) {
    rows.push({ actionKey: 'updated', field: '—', where: '', old: '', new: '', highlight: false });
  }
  return rows;
}

// Render an event's location path as a breadcrumb (e.g. "Housing › Rev. 2"),
// translating each hop's kind only when it has no label of its own.
function formatScope(scope: AuditScope[] | null | undefined): string {
  if (!scope || scope.length === 0) return '';
  return scope.map((s) => s.label || t(`event_${s.type}`)).join(' › ');
}

// A generic event -> row. Field shows the subject's name (or a translated kind
// label when it has none, e.g. the default revision); the action reflects the kind.
function eventRow(ev: AuditEvent): DisplayRow {
  const tag = ev.tag ?? deriveTag(ev.from, ev.to);
  const fallbackLabel = ev.type ? t(`event_${ev.type}`) : '—';
  return {
    actionKey: tagAction(tag),
    field: ev.label ?? fallbackLabel,
    where: formatScope(ev.scope),
    old: ev.from ?? '',
    new: ev.to ?? '',
    highlight: true,
  };
}

const displayLogs = computed(() =>
  logs.value.map((log) => ({ log, rows: rowsFor(log.action, log.changes) })),
);
</script>
