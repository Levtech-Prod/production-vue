export type AuditAction = 'created' | 'updated' | 'deleted';

/** A single changed field: previous and new value (shape varies by field). */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

export interface NamedParam {
  name: string;
  value: string;
}

export interface ParameterDelta {
  added: NamedParam[];
  removed: NamedParam[];
  changed: { name: string; from: string; to: string }[];
}

/**
 * The `changes` payload. Which keys are present depends on `action`:
 *   created / deleted -> `snapshot`
 *   updated           -> `fields` and/or `parameters`
 */
export interface AuditChanges {
  snapshot?: Record<string, unknown>;
  fields?: Record<string, FieldChange>;
  parameters?: ParameterDelta;
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
