import { defineStore } from 'pinia';
import { ref } from 'vue';
import { auditLogsApi } from '../api/auditLogsAPI.ts';
import type { AuditLog } from '../types/auditLogs.ts';

/**
 * Change-log reads, keyed by `entityType:entityId`. Unlike the stock-entries
 * store this does NOT cache-and-skip: audit rows change on every edit, so we
 * always refetch when the Change log tab is opened to avoid showing a stale log
 * that omits the change the user just made.
 */
export const useAuditLogsStore = defineStore('auditLogs', () => {
  const logsByKey = ref<Record<string, AuditLog[]>>({});
  const loadingKey = ref<string | null>(null);

  function keyOf(entityType: string, entityId: number): string {
    return `${entityType}:${entityId}`;
  }

  function getLogs(entityType: string, entityId: number): AuditLog[] {
    return logsByKey.value[keyOf(entityType, entityId)] ?? [];
  }

  function isLoading(entityType: string, entityId: number): boolean {
    return loadingKey.value === keyOf(entityType, entityId);
  }

  async function loadLogs(entityType: string, entityId: number): Promise<void> {
    const key = keyOf(entityType, entityId);
    loadingKey.value = key;
    try {
      const res = await auditLogsApi.getByEntity(entityType, entityId);
      logsByKey.value = { ...logsByKey.value, [key]: res.data };
    } finally {
      if (loadingKey.value === key) loadingKey.value = null;
    }
  }

  return { logsByKey, loadingKey, getLogs, isLoading, loadLogs };
});
