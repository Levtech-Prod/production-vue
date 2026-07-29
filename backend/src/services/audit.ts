// ===========================================================================
// Audit service — generic, application-level change tracking.
// ---------------------------------------------------------------------------
// One reusable helper (`logAudit`) plus pure diff utilities. All writes go
// through a caller-supplied transaction client so the audit row commits
// atomically with the change it describes. Entity-agnostic: parts, part
// categories and products all reuse the same primitives, differing only in the
// field list they pass to `diffFields`.
// ===========================================================================
import type { PoolClient } from 'pg';

export type AuditAction = 'created' | 'updated' | 'deleted';

export type AuditActor = { id?: number | null; name?: string | null };

/** A single field change: previous value and new value. */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

/** A named parameter (part category parameter) and its value. */
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
 * Insert one audit row on the given transaction client. Call before COMMIT so
 * the log and the underlying change succeed or fail together.
 */
export async function logAudit(
  client: PoolClient,
  entityType: string,
  entityId: number,
  action: AuditAction,
  changes: Record<string, unknown>,
  actor: AuditActor,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, changes, actor_id, actor_name)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      entityType,
      entityId,
      action,
      JSON.stringify(changes),
      actor.id ?? null,
      actor.name ?? null,
    ],
  );
}

/**
 * Normalize a value for equality comparison. Handles the two traps in this
 * codebase: node-pg returns NUMERIC columns as strings ("0.12" vs "0.120"),
 * and null / undefined / empty-string should all read as "no value".
 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Numeric-looking strings compare as numbers so "0.12" === "0.120".
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }
  return value;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (typeof na === 'number' && typeof nb === 'number') return na === nb;
  return na === nb;
}

/**
 * Resolve the acting user into `{ id, name }`, snapshotting the username so the
 * log still attributes correctly after the user is deleted. Returns a null
 * actor when there is no authenticated user.
 */
export async function resolveActor(
  client: PoolClient,
  userId: number | null | undefined,
): Promise<AuditActor> {
  if (!userId) return { id: null, name: null };
  const result = await client.query<{ username: string }>(
    `SELECT username FROM users WHERE id = $1`,
    [userId],
  );
  return { id: userId, name: result.rows[0]?.username ?? null };
}

/**
 * Diff two flat rows over a whitelist of fields. Returns only the fields whose
 * normalized values differ, as `{ field: { from, to } }`. Reused across every
 * entity by passing a different field list.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T & string)[],
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const field of fields) {
    if (!valuesEqual(before[field], after[field])) {
      changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
    }
  }
  return changes;
}

/**
 * Diff two sets of named parameters into added / removed / changed. Matched by
 * `name`. Values compared with the same normalization as scalar fields.
 */
export function diffParameters(
  before: NamedParam[],
  after: NamedParam[],
): ParameterDelta {
  const beforeByName = new Map(before.map((p) => [p.name, p.value]));
  const afterByName = new Map(after.map((p) => [p.name, p.value]));

  const added: NamedParam[] = [];
  const removed: NamedParam[] = [];
  const changed: { name: string; from: string; to: string }[] = [];

  for (const { name, value } of after) {
    if (!beforeByName.has(name)) {
      added.push({ name, value });
    } else if (!valuesEqual(beforeByName.get(name), value)) {
      changed.push({ name, from: beforeByName.get(name) ?? '', to: value });
    }
  }
  for (const { name, value } of before) {
    if (!afterByName.has(name)) removed.push({ name, value });
  }

  return { added, removed, changed };
}

/** True when a parameter delta contains no actual changes. */
export function isEmptyParameterDelta(delta: ParameterDelta): boolean {
  return (
    delta.added.length === 0 &&
    delta.removed.length === 0 &&
    delta.changed.length === 0
  );
}
