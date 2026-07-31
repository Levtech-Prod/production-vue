import { api } from './client.ts';
import type { AuditLog } from '../types/auditLogs.ts';

export const auditLogsApi = {
  getByEntity(entityType: string, entityId: number) {
    return api.get<AuditLog[]>('/audit-logs', {
      params: { entityType, entityId },
    });
  },
};
