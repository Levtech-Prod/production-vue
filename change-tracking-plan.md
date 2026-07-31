# Change tracking (audit log) — implementation plan

Track everything that happens to a **part**: creation, updates (what changed, from → to),
and deletion — with who did it and when. Built generically so **part categories** and
**products** reuse the same machinery later. First delivery: parts.

## Decisions (locked)

- **Storage:** one generic `audit_logs` table (not per-entity tables).
- **Capture:** application-level, inside the existing route transactions (not DB triggers).
- **Update scope:** core scalar fields **and** parameters.
- **Delete:** keep hard delete; store a final snapshot so the log still shows what was removed.
- **UI:** a new **Change log** tab in the existing history modal, rendered as a sortable
  **table** with separate old/new columns
  (**Action / Field / Old value / New value / By / When**), matching the current
  Stock history tab. A multi-field update renders as one “Updated” block with one row per
  changed field (Action / By / When span the group).

---

## 1. Data model

New migration `backend/database/migrations/012-add-audit-logs.sql` (and mirror into
`schema.sql`).

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  entity_type VARCHAR(40)  NOT NULL,               -- 'part' | 'part_category' | 'product'
  entity_id   INTEGER      NOT NULL,               -- no FK: must survive hard-deletes
  action      VARCHAR(10)  NOT NULL,               -- 'created' | 'updated' | 'deleted'
  changes     JSONB        NOT NULL DEFAULT '{}',  -- see shapes below
  actor_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(120),                        -- snapshot so log renders after user delete
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_audit_action CHECK (action IN ('created','updated','deleted'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id, created_at DESC);
```

Append-only: no update/delete endpoints are exposed.

### `changes` JSONB shapes

```jsonc
// created — minimal snapshot of the initial state
{ "snapshot": { "name": "M3 screw", "code": "BOLT-0031", "category": "Fasteners" } }

// updated — only changed scalar fields, plus parameter deltas
{
  "fields": {
    "name":  { "from": "M3 screw", "to": "M3×8 screw" },
    "price": { "from": { "amount": 0.12, "currency": "EUR" },
               "to":   { "amount": 0.14, "currency": "EUR" } },
    "categoryId": { "from": 3, "to": 5,
                    "fromLabel": "Fasteners", "toLabel": "Washers" }
  },
  "parameters": {
    "added":   [{ "name": "Length", "value": "8 mm" }],
    "removed": [{ "name": "Coating", "value": "zinc" }],
    "changed": [{ "name": "Grade", "from": "8.8", "to": "10.9" }]
  }
}

// deleted — final snapshot for display after the row is gone
{ "snapshot": { "name": "M3×8 screw", "code": "BOLT-0031" } }
```

Store category as id + resolved label so the UI never has to look up a possibly-deleted
category. Price is compared on the entered amount + currency (what the user actually typed),
not the canonical EUR.

---

## 2. Backend

### 2a. Audit service — `backend/src/services/audit.ts`

The single reusable helper. Inserts using a caller-supplied transaction client so the log
commits atomically with the write.

```ts
type AuditAction = 'created' | 'updated' | 'deleted';
type Actor = { id?: number; name?: string };

// Insert one audit row on the given txn client.
export async function logAudit(
  client: PoolClient,
  entityType: string,
  entityId: number,
  action: AuditAction,
  changes: Record<string, unknown>,
  actor: Actor,
): Promise<void>;

// Diff two flat rows over a whitelist of fields → { field: { from, to } }.
export function diffFields<T extends Record<string, unknown>>(
  before: T, after: T, fields: (keyof T)[],
): Record<string, { from: unknown; to: unknown }>;

// Diff parameter arrays → { added, removed, changed }.
export function diffParameters(
  before: { name: string; value: string }[],
  after:  { name: string; value: string }[],
): { added: ...; removed: ...; changed: ... };
```

`actor.name` comes from the `users` table. The JWT only carries `{ id, email, admin }`, so
resolve the username once (join `users`) or look it up in the service — store the snapshot
in `actor_name`.

### 2b. Wire into `backend/src/routes/parts.ts`

All three handlers already run inside a transaction — add `logAudit` before `COMMIT`.
Four refinements came out of reviewing the real code:

- **POST (create):** after the insert, `logAudit(client, 'part', part.id, 'created',
  { snapshot: {...} }, actor)`.
- **PUT (update) — capture old values in the existing UPDATE, no extra round trip.**
  The handler already runs one `UPDATE ... RETURNING`. Fold a snapshot subquery into it so
  it returns old **and** new in a single statement:

  ```sql
  UPDATE parts
  SET name = $1, ...
  FROM (SELECT * FROM parts WHERE id = $id) old
  WHERE parts.id = old.id
  RETURNING old.name AS "oldName", parts.name AS name, ...
  ```

  Then `diffFields` in JS, writing an audit row **only if something changed**. Resolve
  `categoryId` → name for both sides.
- **PUT — diff the *entered* price only, never the EUR/rate columns.** Every save re-runs
  `convertToEur(amount, currency)` at *today's* BNR rate, so `price_per_piece`, `rate_used`
  and `rate_date` churn whenever the rate moves — diffing them would log phantom price
  changes. Compare only `price_entered_amount` + `price_entered_currency` (what the user
  typed).
- **PUT — build the parameter delta from the reconciliation already done.** The handler
  already selects existing parameters to compute deletes/upserts. Extend that `SELECT` to
  also return `value` + name and derive `{ added, removed, changed }` from it — no second
  query.
- **DELETE:** extend the `RETURNING` clause to capture `name`/`code`, then
  `logAudit(client, 'part', partId, 'deleted', { snapshot }, actor)` before `COMMIT`.

Fields to diff for a part: `name`, `code`, `categoryId`, price (`priceEnteredAmount` +
`priceEnteredCurrency` **only**), `location`, `description`, `image` — plus parameters.

Because parameters live in a related table and price semantics require comparing the entered
values (not the stored canonical EUR), a DB trigger is a poor fit here — confirming the
application-level choice.

### 2c. Read endpoint — `backend/src/routes/auditLogs.ts`

```
GET /api/audit-logs?entityType=part&entityId=123   (requireAuth)
```

Validate query with a new `backend/src/schemas/audit.schema.ts` (Zod: `entityType` enum,
`entityId` positive int). Return newest-first, joining `users` for a live username and
falling back to `actor_name` when the user was deleted. Register the router in the app entry
alongside the others.

---

## 3. Frontend

### 3a. Types, API & store

- `frontend/src/types/auditLogs.ts` — `AuditLog`, `AuditAction`, and the `changes` union.
- `frontend/src/api/auditLogsAPI.ts` — `getByEntity(entityType, entityId)`.
- `frontend/src/stores/auditLogsStore.ts` — mirrors `stockEntriesStore`, but **fetches fresh
  when the Change log tab is opened** (audit rows change on every edit, so no long-lived
  cache — avoids stale data on writes). Exposes loading state per key.

### 3b. Reusable component — `frontend/src/components/ChangeLogTable.vue`

Props: `entityType: string`, `entityId: number`. Fetches on mount / when id changes and
renders the sortable table (**Action / Field / Old value / New value / By / When**),
mirroring the sort + styling of `PartStockHistoryModal`. A small formatter flattens each
`changes` payload into one or more table rows:

- created → one row: Old value “—”, New value = snapshot summary (e.g. “In category X”)
- updated → **one row per changed field**, grouped under a single “Updated” action
  (Action / By / When span via `rowspan`). Each row: `Field | old | new`, e.g.
  `Name | M3 screw | M3×8 screw`, `Price | 0.12 EUR | 0.14 EUR`,
  `Length | — | 8 mm` (added), `Coating | zinc | —` (removed)
- deleted → one row: Old value = snapshot (`“M3×8 screw” (BOLT-0031)`), New value “—”

Field labels come from a per-entity map so the core component stays generic:

```ts
// frontend/src/utils/auditFieldLabels.ts
export const PART_FIELD_LABELS = { name: 'name', code: 'code', categoryId: 'category', ... };
```

Values route through existing helpers (`formatPrice`, `formatDate`).

### 3c. Modal tab integration

Convert `PartStockHistoryModal.vue` into a two-tab modal (or split a shared `<HistoryModal>`
shell): **Stock movements** (existing table) and **Change log** (`<ChangeLogTable
entity-type="part" :entity-id="partId" />`). Title becomes generic (e.g. “History”). Opened
from `PartDetailPanel.vue`.

**Entry-point fix:** today the history button is `v-if="entries.length"`, so it only appears
once stock has moved. Every part always has at least a “created” audit entry, so the change
log always has content — the trigger must no longer be gated on `entries.length` (show it
always, defaulting to the Change log tab when there are no stock movements yet).

### 3d. i18n

Add keys for the tab, columns, and actions (`change_log`, `action`, `changes`, `created`,
`updated`, `deleted`, field labels). Follow the existing i18n setup.

---

## 4. Reuse path (categories & products — later)

Because the table, endpoint, and service are generic, each new entity needs only:

1. Call `logAudit` in that entity's create/update/delete routes (with its own field list).
2. Add its field-label map.
3. Drop `<ChangeLogTable entity-type="part_category|product" :entity-id="id" />` into that
   entity's detail view or modal.

No schema or component changes.

---

## 5. Considerations & edge cases

- **No-op updates:** only write an audit row when `diffFields`/`diffParameters` find a real
  change — avoids empty log spam when a save touches nothing.
- **Actor on stock movements:** the existing stock entries already record `entered_by`; those
  stay in the Stock movements tab and are *not* duplicated into the change log (the change log
  tracks the part record itself, not stock quantity).
- **Image field:** log it as a boolean-ish change (“image updated”) rather than dumping long
  base64/URLs into `changes`.
- **User deletion:** `actor_id` set to NULL on user delete; `actor_name` snapshot preserves
  attribution.
- **Immutability:** app exposes read + insert only. If you later want tamper-proofing, add a
  DB `REVOKE UPDATE, DELETE` on the table.
- **Retention/growth:** append-only table grows unbounded. Fine for now; revisit
  partitioning or a retention window if volume becomes large.
- **Timezone/format:** timestamps stored `TIMESTAMPTZ`; formatted client-side like existing
  dates.

---

## 6. Build order

1. Migration `012-add-audit-logs.sql` + `schema.sql`.
2. `services/audit.ts` (`logAudit`, `diffFields`, `diffParameters`).
3. Wire the three `parts.ts` handlers (add old-row SELECT in PUT; extend DELETE RETURNING).
4. `schemas/audit.schema.ts` + `routes/auditLogs.ts` + register router.
5. Frontend types + api.
6. `ChangeLogTable.vue` + field-label map + i18n keys.
7. Add the Change log tab to the history modal.
8. **Verify:** create/update (single field, multi-field, parameter add/remove/change)/delete
   a part; confirm one correct row each, correct actor + timestamp, no row on no-op save, and
   that the log survives deleting the part.
