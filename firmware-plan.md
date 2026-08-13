# Firmware management — plan

Firmware versions per sub-product revision: upload, version details, change log
and files, reached from the **Documents** panel on the product detail page.

Status: **IMPLEMENTED** (2026-08-13). This document is kept as the design
record; §4.2 and §8 note where the build differs from the original plan.

---

## 0. Already done: document download fix

The download button on document cards was broken. `DocumentTypeCard.vue` and
`DocumentFilesModal.vue` rendered `<a :href="file.downloadUrl">`, but
`downloadUrl` points at `/api/…/download`, which sits behind `requireAuth` — a
link navigation carries no `Authorization` header, so it returned 401 (and in
local dev, 404: Vite only proxies `/uploads`, not `/api`).

Fixed by fetching the bytes through the axios client (which attaches the token)
and handing them to the browser as a blob URL:

- **new** `frontend/src/composables/useFileDownload.ts`
- `DocumentTypeCard.vue`, `DocumentFilesModal.vue` — anchor → button
- `i18n/index.ts` — `errors_download_failed` (en + hu)

`vue-tsc -b` passes. The firmware panel reuses the same composable.

> Note: `npm run build` can't complete in this environment — `node_modules` was
> installed on macOS and the bundler's native binary doesn't load on Linux. The
> type-check half of the build script runs clean; please run the full build on
> your machine.

---

## 1. Decisions so far

| Question | Decision |
|---|---|
| What owns a firmware? | **One sub-product revision** (`firmwares.sub_product_revision_id`). A revision has many firmwares; a firmware belongs to exactly one revision. No junction table. |
| Must a revision always have a production firmware? | No — **at most** one. A revision with everything in Testing is valid. |
| Statuses | **`testing` / `production` / `deprecated`** — no `development`. New firmware starts as `testing`. |
| Production rule | **At most one `production` firmware per sub-product revision** — a partial unique index, enforced by the database. |
| Entry point | **Only when a sub-product revision is selected.** The product-scoped Documents panel is unchanged. |
| File types | **Every extension allowed**, but firmware files are **not** placed in the statically served tree — reachable only through an authenticated download endpoint. |

---

## 2. Why this doesn't reuse the existing document machinery

The `stored_files` + `product_revision_documents` model buys three things:
carry-forward, copy-on-write, and a stateless reference check on delete
(`releaseStoredFile`, with its row lock). None of them mean anything for
firmware — a build artifact isn't inherited by the next revision, and two
firmwares never share a binary.

On top of that, `stored_files.storage_key` is by definition a path under
`uploads/products/`, which Express serves statically. So "allow every
extension" there would make an uploaded `.html` or `.svg` stored XSS on your own
origin.

Hence: **its own flat tables and its own storage directory.** That is less code
than bending the existing system, and the security requirement falls out for
free.

---

## 3. Data model — `019-add-firmwares.sql`

```sql
CREATE TABLE IF NOT EXISTS firmwares (
  id                      SERIAL PRIMARY KEY,
  sub_product_revision_id INTEGER NOT NULL
                            REFERENCES sub_product_revisions(id) ON DELETE CASCADE,
  name                    VARCHAR(120) NOT NULL,          -- "v2.14.3"
  status                  VARCHAR(20)  NOT NULL DEFAULT 'testing'
                            CHECK (status IN ('testing', 'production', 'deprecated')),
  release_notes           TEXT,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive, like the document-type name indexes: "v2.1" beside "V2.1"
-- is a duplicate to anyone reading the list.
CREATE UNIQUE INDEX IF NOT EXISTS ux_firmwares_revision_name
  ON firmwares(sub_product_revision_id, LOWER(name));

-- The production rule, enforced by the database rather than by application
-- code: one row per revision may carry status = 'production'.
CREATE UNIQUE INDEX IF NOT EXISTS ux_firmwares_one_production
  ON firmwares(sub_product_revision_id) WHERE status = 'production';

CREATE INDEX IF NOT EXISTS idx_firmwares_revision_id
  ON firmwares(sub_product_revision_id);

CREATE TABLE IF NOT EXISTS firmware_files (
  id            SERIAL PRIMARY KEY,
  firmware_id   INTEGER NOT NULL REFERENCES firmwares(id) ON DELETE CASCADE,
  storage_key   TEXT     NOT NULL,   -- path relative to uploads/firmware/
  original_name VARCHAR(255) NOT NULL,
  size_bytes    BIGINT   NOT NULL,
  mime_type     VARCHAR(100),
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_firmware_files_storage_key
  ON firmware_files(storage_key);
CREATE INDEX IF NOT EXISTS idx_firmware_files_firmware_id
  ON firmware_files(firmware_id);
```

`schema.sql` gets the same as an idempotent block, per the project convention.

**Your field list, mapped:** name → `name`; creation date → `created_at`;
who created it → `created_by` → `users.username`; status → `status`;
release note → `release_notes`; linked sub-product revision →
`sub_product_revision_id`; uploaded files → `firmware_files`.

`created_by` is actually written here (`req.user.id`), unlike
`product_revisions.created_by`, which exists in the schema but is never set.

---

## 4. Storage and serving

### 4.1 Where the files live

Inside the owning sub-product's folder, beside its documents:

```
uploads/
  _tmp/
    firmware/        ← firmware upload staging
  products/
    {product}/
      sub-products/
        {sub-product}/
          documents/
            datasheet.pdf
            firmware/
              {fwId}-{version}/
                firmware.hex
                programmer.exe
```

The firmware folder is located by the same immutable `{id}-` prefix rule as the
rest of the tree, so `uploadPaths.ts`'s `findEntityFolder` /
`canonicalFolderName` are reused and a rename never requires rewriting a
`storage_key`. Keys are relative to `productsDir`, exactly like a document's.

Deleting a sub-product needs no firmware-specific cleanup: `removeEntityFolder`
takes the documents folder, and the firmware tree inside it, with everything
else. Only a *revision* delete removes folders individually, since several
revisions of one sub-product share the folder.

### 4.2 Keeping firmware out of static serving

Firmware now lives under `uploads/products/`, which **is** statically served,
and it accepts every file extension — so an uploaded `.html` or `.svg` would be
stored XSS on the app's own origin. A middleware registered *before* the
unchanged static mount 404s any `/uploads/**` path containing a `firmware`
segment:

```ts
app.use('/uploads', (req, res, next) => {
  for (const segment of req.path.split('/')) {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* malformed escape */ }
    if (decoded.toLowerCase() === 'firmware') return res.sendStatus(404);
  }
  next();
});
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
```

Three details that are not decoration:

- **A segment match, not a prefix.** The folder is nested inside the product
  tree, so there is no fixed prefix to block.
- **Segments are decoded first.** `express.static` decodes the path itself, so a
  request for `%66irmware` would otherwise slip past the guard and still resolve
  to the same directory.
- **Case-insensitive.** On a case-insensitive filesystem `FIRMWARE` reaches the
  same folder.

Staging lives at `uploads/_tmp/firmware/` rather than a new root folder, so the
same guard covers half-written uploads — `_tmp` itself is served.

An earlier draft narrowed the static mount to an allow-list of subtrees
instead. That was wrong: `uploads/` also holds part, part-category and supplier
images (`routes/uploadFiles.ts`), which the narrowing would have broken.

### 4.3 Download

One authenticated endpoint, `Content-Disposition: attachment`:
`GET /api/firmware-files/:fileId/download`, consumed through the
`useFileDownload` composable from §0.

### 4.4 Upload limits

- A separate multer instance: **no `fileFilter`** (every extension), staging
  under `uploads/firmware/_tmp`, `.array('files', 20)` so several files can be
  attached at once.
- Size: **100 MB per file**, overridable with `FIRMWARE_MAX_UPLOAD_MB`
  (added to `.env.example`). nginx `client_max_body_size` 25m → 100m.
- `tmpSweeper` also sweeps the firmware staging dir. It needs none of the
  `stagedNamesInUse` logic — nothing references a firmware staging file
  mid-flight, so "older than 24h" is simply garbage.

---

## 5. API

New route file `backend/src/routes/firmwares.ts`, schemas in
`backend/src/schemas/firmwares.schema.ts` (zod, validated at the boundary).
The list route mirrors the existing document route shape exactly.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/sub-products/:spId/revisions/:revId/firmwares` | The whole list in one call — every firmware with its files. A revision has few firmwares, so both the left-hand list and the right-hand details come from this single response; selecting a version costs no request. |
| `POST` | `/api/sub-products/:spId/revisions/:revId/firmwares` | Create (JSON): `name`, `status`, `releaseNotes`. |
| `PUT` | `/api/firmwares/:id` | Update the same fields. |
| `DELETE` | `/api/firmwares/:id` | Delete — files are unlinked *after* the commit. |
| `POST` | `/api/firmwares/:id/files` | Multipart, multiple files. |
| `DELETE` | `/api/firmware-files/:fileId` | Delete one file. |
| `GET` | `/api/firmware-files/:fileId/download` | `requireAuth`, attachment. |

**Server-side rules**

- `:revId` must belong to `:spId` — the same `spRevisionBelongsTo` check the
  document routes already do, so a valid revision under the wrong parent is a
  404 rather than a silent cross-read.
- Setting `production`: the revision's current production firmware is demoted to
  `deprecated` in the same transaction, then the new one is promoted. Scoped to
  one revision, so nothing outside it is affected. The unique index is the
  backstop if two requests race.
- Name collision → `FIRMWARE_NAME_ALREADY_EXISTS` (409).
- New `ErrorCodes`: `INVALID_FIRMWARE_ID`, `FIRMWARE_NOT_FOUND`,
  `FIRMWARE_NAME_ALREADY_EXISTS`, `INVALID_FIRMWARE_FILE_ID`,
  `FIRMWARE_FILE_NOT_FOUND`, `FIRMWARE_FILE_MISSING`, `FIRMWARE_TOO_LARGE`.
- Deleting a sub-product cascades the `firmwares` rows but not the disk: the
  delete branch in `subProducts.ts` gets a `removeFirmwareFolder(spId)` call
  next to the existing `removeEntityFolder`, post-commit like every other
  unlink. Deleting a single revision unlinks only that revision's firmware
  files.

---

## 6. Frontend

### 6.1 Entry point on the Documents panel

In `DocumentsPanel.vue`, **above** the card grid and only when
`scope.kind === 'spRev'`: a full-width highlighted bar, visually distinct from
the document-type cards (coloured border, `Cpu` icon), showing the firmware
count and the current production version.

```
┌────────────────────────────────────────────────────────────┐
│ ⚙  Firmware            6 versions · Production: v2.14.3 →  │
└────────────────────────────────────────────────────────────┘
```

Click emits `open-firmware`.

### 6.2 View switching

`ProductDetailView.vue` gains `documentsView = ref<'documents' | 'firmware'>`.
The Documents tab renders either `DocumentsPanel` or `FirmwarePanel`. Going back
is a `← Documents` button in the firmware header. The view resets to
`documents` when the selection moves to product scope (no firmware there) and on
product change.

### 6.3 Section layout

```
┌──────────────────────────────────────────────────────────────┐
│ ← Documents   Firmware — Control board · Rev. 3      [+ New] │
├───────────────┬──────────────────────────────────────────────┤
│ Change log    │  v2.14.3        [Production]     [⋮ actions] │
│               │  ┌────────────────────┬─────────────────────┐ │
│ ● v2.14.3 Pro │  │ Version   v2.14.3  │ 👑 This is the      │ │
│ ● v2.15b1 Tst │  │ Status    Production│    production       │ │
│ ● v2.14.2 Dep │  │ Created   2026-…   │    firmware         │ │
│               │  │ Created by Levente │                     │ │
│  (scrolls)    │  │ Revision  Rev. 3   │ [Set as production] │ │
│               │  └────────────────────┴─────────────────────┘ │
│               │  Release notes …                              │
├───────────────┴──────────────────────────────────────────────┤
│ Uploaded files                              [+ Upload file]  │
│  📄 firmware.hex 512 KB ⤓ 🗑   📄 programmer.exe 1.8 MB ⤓ 🗑  │
└──────────────────────────────────────────────────────────────┘
```

Grid: `grid-rows-[auto_1fr_auto]`, middle row `grid-cols-[16rem_1fr]`.

The left-hand list follows `revisions/RevisionTimeline.vue` (status dot, rail,
active highlight), but `RevisionTimelineItem` is **not** reused — different
status set, different fields. What carries over is the pattern of the
`statusDot` / `statusBadgeClass` helpers, mirrored in a small
`firmwareHelpers.ts`.

### 6.4 New files

```
frontend/src/types/firmware.ts
frontend/src/api/firmwareAPI.ts
frontend/src/views/products/detail/firmware/
  FirmwarePanel.vue            – shell: header + three regions
  FirmwareChangeLog.vue        – left list (+ status filter)
  FirmwareChangeLogItem.vue
  FirmwareDetails.vue          – right-hand details + release notes
  FirmwareFiles.vue            – bottom file strip (drop zone + list)
  FirmwareFormModal.vue        – create / edit
  firmwareHelpers.ts           – status badge / dot classes
  composables/useFirmwares.ts  – load (cached per revision), CRUD, delete confirm
```

Touched: `DocumentsPanel.vue`, `ProductDetailView.vue`, `i18n/index.ts` (en + hu).

`useFirmwares` follows `useDocuments`: cache keyed by revision, a token guard so
a slow response can't overwrite a newer selection, and a refetch after every
mutation rather than patching the cached tree by hand.

### 6.5 Permissions

Same as documents: any authenticated user, blocked on archived products
(`canEdit`). Not admin-only — say the word if it should be.

---

## 7. Implementation steps

1. **Migration + schema.sql** — `019-add-firmwares.sql` and the idempotent block.
2. **`uploadPaths.ts`** — `firmwareDir`, `firmwareTmpDir`, `ensureFirmwareDir`, `resolveUnderFirmware`, `removeFirmwareFolder`.
3. **`server.ts`** — narrow the static mount, register the firmware routes.
4. **`tmpSweeper.ts`** — sweep the firmware staging dir.
5. **`errorCodes.ts`** — new codes.
6. **`schemas/firmwares.schema.ts`** — zod.
7. **`services/firmwareFiles.ts`** — disk operations (place, unlink, remove folder).
8. **`routes/firmwares.ts`** — the §5 endpoints.
9. **`subProducts.ts`** — firmware folder cleanup on delete.
10. **`nginx.conf` + `.env.example`** — size limit.
11. **Frontend types + API client.**
12. **`useFirmwares.ts`.**
13. **Firmware components** (panel → list → details → files → modal).
14. **Entry point + view switching** (`DocumentsPanel`, `ProductDetailView`).
15. **i18n** en + hu.
16. **Verification:** `vue-tsc -b` and `tsc` on the backend; run the migration against a local DB; manual pass (create → upload → download → promote to production → delete); confirm `/uploads/firmware/...` returns **404** in a browser; confirm promoting a second firmware demotes the first.

---

## 8. Settled details

1. **Filename collision inside one firmware: overwrite.** Re-uploading
   `firmware.hex` replaces it rather than storing `firmware.hex (1)` — a new
   build of the same artifact, not a second file. This makes the storage key a
   pure function of firmware + file name, which is what lets the insert upsert
   on `ux_firmware_files_storage_key`.
2. **Change log: both.** The left-hand list is the firmware version list, as in
   the mockup. Firmware create / update / delete and file uploads *also* appear
   in the owning product's change log (`audit_logs`, event types `firmware` and
   `firmware_file`, scoped to sub-product › revision).
3. **Executables are flagged.** `.exe`, `.msi`, `.bat`, `.sh`, `.jar`, `.apk`
   and friends get a warning chip in the file list. Uploading them stays
   allowed — a vendor flashing tool beside the .hex is a normal deliverable.

## 9. Verification performed

- `tsc --noEmit` (backend) and `vue-tsc -b` (frontend) both clean.
- `schema.sql` and `019-add-firmwares.sql` were run against a real PostgreSQL
  16: fresh install, re-run for idempotency, and the migration applied to a
  database that already had the tables.
- Behaviour verified with live data: several firmwares per revision accepted; a
  second `production` on the same revision rejected by
  `ux_firmwares_one_production`; `production` on a *different* revision
  accepted; duplicate names rejected case-insensitively but allowed across
  revisions; the demote-then-promote transaction leaves exactly one production;
  the file upsert updates in place; deleting a revision or a sub-product
  cascades firmwares and files; deleting a user nulls `created_by` and keeps
  the firmware.
- The path helpers were exercised against a scratch tree: the folder lands at
  `{product}/sub-products/{sub}/documents/firmware/{fwId}-{version}`, survives a
  sub-product rename, rejects traversal keys, and removing one firmware leaves
  the sibling `documents/` folder intact.
- The static guard was run against a real Express app with the production
  middleware verbatim: firmware files, a percent-encoded `%66irmware` path, an
  uppercase `FIRMWARE` path and the staging folder all return 404, while a
  normal document and a part image still return 200.
- Not verified here: the running UI, and `npm run build` — this machine's
  `node_modules` is macOS-installed and the bundler's native binary will not
  load in the Linux sandbox. Please run the app locally before deploying.
