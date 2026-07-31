export type AuditAction = 'created' | 'updated' | 'deleted';

/** A single changed field: previous and new value (shape varies by field). */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

/** One hop in an event's location path (e.g. sub-product → its revision). */
export interface AuditScope {
  type: string;
  label: string;
}

/**
 * A generic change item — the single mechanism for every collection change
 * (part/category parameters, a product's sub-products, BOM parts, revisions).
 */
export interface AuditEvent {
  type: string;
  tag: 'added' | 'removed' | 'changed';
  /** Subject's own name for the Field column; falls back to the `type` label. */
  label?: string | null;
  /** Location path from the entity down to the subject (outermost first). */
  scope?: AuditScope[] | null;
  from?: string | null;
  to?: string | null;
}

/**
 * The `changes` payload. Which keys are present depends on `action`:
 *   created / deleted -> `snapshot`
 *   updated           -> `fields` and/or `events`
 */
export interface AuditChanges {
  snapshot?: Record<string, unknown>;
  fields?: Record<string, FieldChange>;
  events?: AuditEvent[];
}

export interface AuditLog {
  id: number;
  entityType: string;
  entityId: number;
  action: AuditAction;
  changes: AuditChanges;
  createdAt: string;
  /** Live username, or the snapshot taken at write time if the user was deleted. */
  actorName: string | null;
}
