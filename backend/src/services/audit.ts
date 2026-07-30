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

/**
 * One hop in an event's location path, from the logged entity down to the
 * subject (e.g. sub-product → sub-product revision). `type` is an i18n key
 * suffix (`event_<type>`); `label` is that hop's own name (e.g. 'Rev. 2').
 */
export interface AuditScope {
  type: string;
  label: string;
}

/**
 * A generic, extensible change item for entities whose log spans related
 * records (e.g. a product's sub-products and BOM parts).
 *
 *  - `type`  names the subject kind (i18n key suffix), used as the Field label
 *            when no `label` is given (e.g. 'default_revision').
 *  - `tag`   is the change kind shown in the Type column.
 *  - `label` is the subject's own name for the Field column (part/sub-product/
 *            revision name); omit to fall back to the `type` label.
 *  - `scope` locates the subject within the entity's tree (outermost first),
 *            e.g. which sub-product + revision a BOM part change happened in.
 *            Omit for top-level changes with no meaningful location.
 *  - `from` / `to` hold the old / new detail values.
 */
export interface AuditEvent {
  type: string;
  tag: 'added' | 'removed' | 'changed';
  label?: string | null;
  scope?: AuditScope[];
  from?: string | null;
  to?: string | null;
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

/** A keyed, labelled value for diffing collections into events. */
export interface KeyedValue {
  /** Stable identity for matching (parameter id, etc.); undefined = new item. */
  key: string | number | undefined;
  /** Display name for the Field column. */
  label: string;
  /** The value compared for changes (a raw value, or a descriptor string). */
  value: string;
}

/**
 * Diff two keyed collections into add / remove / change events. Matched by
 * `key` (stable across renames); items with no key are treated as additions.
 * The single mechanism used for both part parameter values and part-category
 * parameter definitions.
 */
export function diffKeyedEvents(
  before: KeyedValue[],
  after: KeyedValue[],
  type: string,
): AuditEvent[] {
  const beforeByKey = new Map(
    before.filter((x) => x.key != null).map((x) => [x.key, x]),
  );
  const afterKeys = new Set(after.filter((x) => x.key != null).map((x) => x.key));

  const events: AuditEvent[] = [];
  for (const a of after) {
    const prev = a.key != null ? beforeByKey.get(a.key) : undefined;
    if (!prev) {
      events.push({ type, tag: 'added', label: a.label, to: a.value });
    } else if (!valuesEqual(prev.value, a.value)) {
      events.push({ type, tag: 'changed', label: a.label, from: prev.value, to: a.value });
    }
  }
  for (const b of before) {
    if (b.key != null && !afterKeys.has(b.key)) {
      events.push({ type, tag: 'removed', label: b.label, from: b.value });
    }
  }
  return events;
}
