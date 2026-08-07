# Required Document Types — Functional Plan & Jira Stories

Upgrade the existing document system so that **document requirements are defined once per type** (product type / sub-product type) and every product / sub-product of that type shows those requirements as status-tracked cards on its Documents panel.

Decisions locked in with the team:

- **Templates are defined per type.** Required docs belong to a product type or a sub-product type; all instances of that type inherit them.
- **Docs are stored per revision** — sub-product docs per sub-product revision (as today), main-product docs per **product revision**.
- **No physical duplication across revisions.** Files are shared by *pointer*: creating a new revision carries forward the previous revision's document rows pointing at the same stored files, so unchanged files are never re-stored. Changing a file makes a private copy for that revision only (**copy-on-write**), and a stored file is deleted only when no revision points at it. See §3.
- **Edits allowed in any revision status** (not just draft) — but every destructive/overwriting action (delete a file, replace a file) requires a **confirmation modal**.
- **Catch-all preserved.** Alongside the predefined slots, users can still upload arbitrary files into an "Other documents" bucket.
- **Icon picker.** Admins pick the card icon from a curated set of `lucide-vue-next` icons.

---

## 1. Current state (what exists today)

| Area | Today |
| --- | --- |
| Product docs | `product_documents`, attached to **`product_id`** (whole product, not a revision). Each row stores its own `filename`/`path`/`mime_type` — identical files are physically duplicated. |
| Sub-product docs | `sub_product_revision_documents`, attached to a **`sub_product_revision_id`**. Same per-row physical storage. |
| Types | `product_types` / `sub_product_types` managed lists; `products.type` / `sub_products.type` FK to them by name. No document config. |
| Panel UI | `DocumentsPanel.vue` — a simple list with upload/delete, no required slots, no status, no summary. |
| Panel scope | `PanelScope` already carries `{ kind: 'product'; revId }` or `{ kind: 'spRev'; spId; revId }` — the selected product revision id is **already available** to the panel. |
| Download | Files link with `target="_blank"` (opens, not forced download). |
| Settings | `ProductTypesView.vue` manages the two type lists via reusable `TypeManagerSection`. |

---

## 2. Target behaviour

**Settings (admin).** For each product type and each sub-product type, an admin defines an ordered list of **document types**, each with: name, icon (from picker), and an optional allowed file type / extension list. Example — sub-product type *PCB* → Gerber Files, Drill Files, Pick & Place, Assembly Drawing, Schematic PDF, PCB Source, BOM, Manufacturing Notes, Test Procedure.

**Documents panel.** When viewing a product revision or a sub-product revision, the panel renders one **card per document type** (icon, name, file count, status badge): **Teljes/Complete** (≥1 file), **Hiányzik/Missing** (required, 0 files), **Nem releváns/Optional** (non-required, 0 files). Each card lists its files with **download** buttons and an upload control whose `accept` is restricted to the type's extensions. A separate **"Other documents"** card holds ad-hoc uploads. A **summary box** shows total types, uploaded, missing.

---

## 3. Data model

Three ideas: (1) per-type **templates**, (2) a **stored-files** table so each physical file is stored once and referenced, (3) thin **per-revision document rows** that point at a stored file — plus **carry-forward** and **copy-on-write** behaviour (§3.4).

### 3.1 Templates (per type)

```sql
CREATE TABLE product_document_types (
  id              SERIAL PRIMARY KEY,
  product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  icon            VARCHAR(60)  NOT NULL,            -- lucide-vue-next icon name
  allowed_extensions TEXT[] NOT NULL DEFAULT '{}',  -- e.g. {'.zip'}; empty = any
  required        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_type_id, name)
);
-- sub_product_document_types: identical, FK → sub_product_types(id).
```

### 3.2 Stored files — each physical file stored once

```sql
CREATE TABLE stored_files (
  id           SERIAL PRIMARY KEY,
  storage_key  TEXT     NOT NULL,   -- relative path within uploads/documents/ (internal)
  size_bytes   BIGINT   NOT NULL,
  mime_type    VARCHAR(100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

One row per physical file. A file is shared across revisions by having several document rows point at the same `stored_files.id` — nothing is copied on disk. (No content hashing in v1; optional dedup-by-hash is a possible phase-2 add — see §7.)

**On-disk layout — per entity, not per revision**, with folders anchored by the entity's **immutable id** for rename-stability. In v1 a stored file only ever belongs to one product or one sub-product (carry-forward shares files only among *that entity's* revisions — cross-entity sharing would need phase-2 hash dedup). So each product / sub-product keeps its own folder, and all of its revisions share the files inside it. Files are **not** split per revision — that is what lets revisions share a file without duplicating it; the database records which revision uses which file.

Folder name = `{id}-{name}-{sku}` for products, `sub-{id}-{name}-{sku}` for sub-products (`id` = `products.id` / `sub_products.id`, the SERIAL PK — never changes, unlike name/sku). The `{id}-` prefix keeps the folder human-readable *and* findable after a rename.

```
uploads/documents/
  4-Universal-service-remote-control-LSP-FRU-1/   ← product id 4, ALL revisions share this
    firmware_v1.hex        (Rev.1 firmware)
    firmware_v2.hex        (Rev.2 firmware — added on replace, copy-on-write)
    bootloader.hex         (shared by Rev.1 & Rev.2 — stored once)
    release_notes.pdf      (shared by Rev.1 & Rev.2 — stored once)
  sub-12-PCB-PCB-001/       ← sub-product id 12, ALL its revisions
    Gerber_v2.zip
    ...
```

`storage_key` is the relative path (e.g. `4-Universal-service-remote-control-LSP-FRU-1/firmware_v2.hex`). **Folder resolution matches on the `{id}-` prefix, not the full name**: if a folder starting with `4-` exists, reuse it whatever its name suffix; only create one when none exists — so a rename can never fragment a product into two folders, and existing `storage_key`s never need rewriting. The existing unique-naming (`" (n)"` suffix) prevents collisions within a folder. Because the current code already stores files in per-entity folders, the §3.5 migration does **not** move files — it records each existing file's current path as its `storage_key` (a one-time pass can add the `{id}-` prefix to legacy folders if desired). Optional nicety: on rename, rename the physical folder (keeping the `{id}-` prefix) and update that entity's `storage_key`s in the same transaction so the folder shows the current name — skippable in v1 since the id anchor already guarantees findability.

### 3.3 Per-revision document rows point at a stored file

```sql
CREATE TABLE product_revision_documents (
  id                  SERIAL PRIMARY KEY,
  product_revision_id INTEGER NOT NULL REFERENCES product_revisions(id) ON DELETE CASCADE,
  document_type_id    INTEGER REFERENCES product_document_types(id) ON DELETE SET NULL, -- NULL = "Other"
  stored_file_id      INTEGER NOT NULL REFERENCES stored_files(id),
  original_name       VARCHAR(255) NOT NULL,   -- display name; can differ per revision
  uploaded_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- sub_product_revision_documents: reshaped the same way (stored_file_id + document_type_id),
-- keyed by sub_product_revision_id.
```

`document_type_id` NULL = the ad-hoc "Other documents" bucket. Multiple files may share one `document_type_id`.

### 3.4 The sharing rules — carry-forward, copy-on-write, and cleanup

- **Carry-forward.** Creating a revision copies the previous revision's document *rows*, pointing at the same `stored_file_id`s. No files written. Unchanged files are simply shared.
- **Copy-on-write.** Editing or replacing a file never mutates a shared file in place. It writes a **new** `stored_files` row and repoints only *that* revision's document row — so changing a file in one revision can never alter another revision that was sharing it. (This is what makes editing an *active* revision safe.)
- **Cleanup (no fragile counters).** Deleting a document row is followed by a stateless check — `SELECT 1 FROM …_documents WHERE stored_file_id = $1` — and the physical file is unlinked only if nothing else points at it. (Optional nightly GC sweep as a safety net.)

Worked example: Rev.1 has files A, B, C. Rev.2 is created (points at A, B, C — 0 new files). You replace only the firmware in Rev.2 → new file D, Rev.2 now points at D/B/C, Rev.1 still at A/B/C. Disk holds 4 files, not 6; B and C are stored once and shared.

### 3.5 Migration of existing data

Migrate current `product_documents` and `sub_product_revision_documents` into the new shape: insert one `stored_files` row per existing file, create the matching revision-document row (product docs backfilled to each product's default/earliest revision), then retire the old columns/tables. Keep the old tables one release for rollback. All via new migration files + idempotent `schema.sql` blocks — never a manual `schema.sql`-only edit.

---

## 4. API

Admin-only writes (`requireAdmin`) for templates, auth reads; Zod validation at the boundary; parameterized queries; consistent `ErrorCodes` shape.

**Templates:** `GET/POST /api/{product|sub-product}-types/:typeId/document-types`, `PUT/DELETE /api/{…}-document-types/:id`, `PUT …/document-types/reorder`.

**Panel data (grouped):** `GET /api/product-revisions/:revId/documents` and `GET /api/sub-products/:spId/revisions/:revId/documents` return:

```jsonc
{
  "documentTypes": [{ "id", "name", "icon", "allowedExtensions", "required",
                      "status": "complete|missing|optional",
                      "files": [{ "id", "originalName", "downloadUrl", "createdAt" }] }],
  "other": [{ "id", "originalName", "downloadUrl", "createdAt" }],
  "summary": { "totalTypes", "uploaded", "missing" }
}
```

**Upload / replace:** existing multipart endpoints gain an optional `documentTypeId`. Server writes a `stored_files` row, verifies the template belongs to the entity's type, and rejects files whose extension isn't in the template's `allowedExtensions` (when set), plus the existing MIME allow-list (widen it for engineering formats: `.step`, `.hex`, `.elf`, `.pcbdoc`, …). **Replace** repoints the revision's document row at the new stored file (copy-on-write) and then runs the cleanup check on the old file.

**Delete:** removes the document row, then runs the stateless cleanup check (unlink the physical file only if unreferenced).

**Download:** `GET /api/{product|sub-product-revision}-documents/:docId/download` streams the file with `Content-Disposition: attachment; filename="<originalName>"`.

---

## 5. Frontend

**Settings.** A screen to manage document types per selected product/sub-product type: add/edit/delete/reorder rows with name, **icon picker** (searchable curated `lucide-vue-next` set, storing the icon name), optional extensions (chips), required toggle. New API module + `documentTypesStore`. A shared `resolveIcon(name)` helper (with safe fallback) is used by both picker and panel so the whitelist is a single source of truth.

**Documents panel.** Rewrite `DocumentsPanel.vue` (+ a `DocumentTypeCard.vue` sub-component to keep files focused) to render the card grid, the "Other documents" card, and the summary box from the grouped payload, for both scopes. Upload `accept` derives from the card's extensions; each file has download, replace, and delete. **Delete and replace both open a confirmation modal** (reuse `useConfirmDelete` / a small `useConfirmAction`) before the action runs, regardless of revision status. `useDocuments` is updated to the grouped shape and to pass `documentTypeId` through upload. Note the project quirk: `.input`/`.btn`/`.card` are unlayered and override Tailwind utilities — use inline style / `!important` where a card must beat them.

---

## 6. Seed data (optional, speeds QA)

Data-only migration seeding the example templates (guarded by type existence + `ON CONFLICT DO NOTHING`): **PCB** (Gerber, Drill, Pick & Place, Assembly Drawing, Schematic PDF, PCB Source, BOM, Manufacturing Notes, Test Procedure), **Készülékház** (STEP, Native CAD, CNC Program, CAM Project, Drawing PDF, Assembly Manual, Laser File), **Firmware** (Source code, Compiled HEX, Release notes, Programming instructions), **main product** (firmware.hex, firmware.elf, firmware.map, source.zip, release_notes.pdf, bootloader.hex, programmer.exe).

---

## 7. Risks & sequencing

1. **Migrating existing docs into the stored-files model** — insert a `stored_files` row per current file and backfill product docs to a revision (fallback for products with no default/earliest revision). Ship additive, cut the app over, retire old tables a release later.
2. **Copy-on-write + cleanup correctness** — replacing/deleting must never unlink a file another revision still points at; the stateless "is anything else referencing this?" check (not a stored counter) guards this. An optional nightly GC sweep catches any orphans.
3. **Template deletion vs. files** — deletion demotes a type's files to "Other" (`ON DELETE SET NULL`), never destroying them, but the UI must warn first: if the type has uploaded files anywhere, a confirmation modal explains they'll be moved to "Other documents" and the admin must click to confirm.
4. **Extension vs. MIME** — enforce both; engineering formats often have no reliable MIME, so the extension list is the practical gate.
5. **Phase-2 option — content-hash dedup.** If storage ever warrants deduping identical files uploaded independently (not via carry-forward), add a `sha256` column to `stored_files` and reuse on match. Not needed for the core requirement, which carry-forward already satisfies.

Suggested order: **1 → 3 → 4 → 2 → 5 → 6 → 7**, driven by dependencies and by getting a testable feature on screen early:

- **1** first — foundation; nothing builds or tests without the schema + migrated data.
- **3 → 4** (template track) — API then settings UI; Story 4 also produces the shared `resolveIcon` helper the panel needs later.
- **2 → 5** (documents track) — file-sharing backend then the panel API; can run in parallel with the template track after Story 1 (two-developer split, converging at Story 6).
- **6** — panel UI; needs Story 5 for data *and* Story 4 for `resolveIcon`, so both tracks land first.
- **7** — seed + E2E last. Optional: pull the **seed migration** forward to right after Story 3 so there are real document types to click through while building the UIs; keep the E2E half at the end.

---

## 8. Jira stories

Seven stories. Labels: `documents`, plus `backend`/`frontend`/`db`/`qa`.

**1 — Schema & migrations** · *backend, db*
Add template tables (`product_document_types`, `sub_product_document_types`), the `stored_files` table, and reshape the two documents tables to point at a stored file + a document type; move product docs to per **product revision**; migrate existing files/rows into the new shape.
AC:
- All new tables + columns exist with FKs, uniqueness, and indexes; migrations idempotent and re-runnable; `schema.sql` updated (not hand-edited alone).
- Existing product/sub-product documents are migrated: one `stored_files` row per file (`storage_key` = its current relative path under `uploads/documents/`, no files moved), a matching revision-document row created, product docs backfilled to the default/earliest revision.
- Old tables/columns retained one release for rollback.

**2 — File sharing: carry-forward, copy-on-write, cleanup** · *backend*
Creating a product/sub-product revision copies the previous revision's document rows (same `stored_file_id`s, no file copy). Replacing a file writes a new stored file and repoints only that row. Deleting/replacing runs a stateless reference check and unlinks the physical file only when unreferenced.
AC:
- New revision inherits the prior revision's documents by reference; no files written on carry-forward.
- Replacing a file in one revision creates a new stored file (in the same entity folder) for that revision only; other revisions sharing the old file are unchanged (copy-on-write).
- Deleting a document unlinks the physical file only when no other row points at it; a shared file survives.

**3 — Template management API** · *backend*
CRUD + reorder for product-type and sub-product-type document types (name, icon, allowedExtensions, required, sort_order). Admin-only writes, auth reads, Zod-validated.
AC:
- CRUD + reorder work for both families; icon validated against the allowed set; extensions normalised (lowercase, leading dot).
- Duplicate name within a type → 409 with a specific code; GET ordered by `sort_order` then name; parameterized queries; consistent error shape.
- Delete demotes any files referencing the type to "Other" (`document_type_id` → NULL) — files are never destroyed; the response reports how many files were affected so the UI can confirm.

**4 — Settings UI for document types** · *frontend*
Icon picker (`IconPicker.vue` + shared `resolveIcon`) and a settings screen to add/edit/delete/reorder document types per selected type; new API module + `documentTypesStore`.
AC:
- Admin can manage and drag-reorder document types per type (name, icon, optional extensions, required); non-admins have no write actions.
- Deleting a type that has uploaded files shows a confirmation modal (reusing `useConfirmDelete`) stating the files will be moved to "Other documents"; the delete runs only after the admin clicks the confirm button, and is cancellable.
- Picker and panel share one icon whitelist with a safe fallback; success/error toasts; HU + EN strings.

**5 — Panel API: grouped documents, upload/replace, download** · *backend*
Grouped GET (documentTypes + status + files, `other`, `summary`) for both scopes; upload/replace accepts `documentTypeId` with template-ownership + extension enforcement; forced-download endpoints.
AC:
- GET returns per-type status (`complete`/`missing`/`optional`), the `other` bucket, and server-computed `summary{totalTypes, uploaded, missing}`, ordered by `sort_order`.
- Upload stores `document_type_id` (omitted → "Other"); rejects a mismatched `documentTypeId` and a file whose extension isn't allowed (specific error codes).
- Files are written into the entity's `{id}-{name}-{sku}` (or `sub-{id}-…`) folder, resolved by matching the `{id}-` prefix so a rename never fragments a product into two folders; existing unique-naming avoids collisions.
- Replace repoints the row (copy-on-write) and cleans up the old file; download forces attachment with the original filename; 404 on missing.

**6 — Documents panel UI** · *frontend*
Rewrite the panel into the card grid (`DocumentTypeCard.vue`): one card per type with icon, file count, status badge, per-file download / replace / delete, and extension-restricted upload; an "Other documents" card; a summary box + status legend. Wire the product scope to the per-revision endpoint (revId already in `PanelScope`).
AC:
- Cards, "Other" bucket, and summary render from the grouped payload for both product-revision and sub-product-revision scopes and match the mockup; uses `lucide-vue-next`.
- Deleting or replacing a file opens a confirmation modal (works in any revision status) and runs only after the user confirms.
- Upload `accept` limited to the card's extensions; counts/summary update live after upload/replace/delete; Rev.1 vs Rev.2 show their own documents (cache keyed per scope); HU + EN labels.

**7 — Seed & end-to-end verification** · *db, qa*
Seed the example templates (guarded, `ON CONFLICT DO NOTHING`) and verify the full flow.
AC:
- Seeding populates PCB / Készülékház / Firmware / main-product example types; safe to re-run; no-op when types absent.
- E2E passes: define types → open product & sub-product → see cards/status/summary → upload restricted + ad-hoc → download → replace/delete (with confirmation) → carry-forward across a new revision confirmed with no physical duplication, and copy-on-write isolation between revisions verified; admin-only settings confirmed.
