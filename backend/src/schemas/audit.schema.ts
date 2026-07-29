import { z } from 'zod';

/** Entities that currently have change tracking. Extend as coverage grows. */
export const auditEntityTypes = ['part', 'part_category', 'product'] as const;

/** Query params for GET /api/audit-logs. */
export const auditLogQuerySchema = z.object({
  entityType: z.enum(auditEntityTypes),
  entityId: z.coerce.number().int().positive(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
