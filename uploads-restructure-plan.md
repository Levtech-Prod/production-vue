# Uploads Folder Restructure — Plan

> **Status: implemented; migration run on dev.** Production still to do —
> see §7 for the runbook.

Move `backend/uploads/` from flat per-target folders plus a separate `documents/`
tree to **one folder per product**, so every file belonging to a product — its
image, its documents, its sub-products and their images and documents — sits
under a single directory that is meaningful to browse by hand.

Decisions locked in:

- **Folder names are frozen at creation**, resolved by the immutable `{id}-`
  prefix exactly as `resolveEntityFolder` already does. `storage_key` is
  therefore never rewritten. Renaming a product leaves its folder name stale;
  that is accepted, and §3.1 covers how the folder stays findable.
- **No `sub-` prefix** on sub-product folders — the parent `sub-products/`
  folder already disambiguates.
- **`sub_products.product_id` becomes `NOT NULL`.** Every sub-product provably
  has a parent folder.
- **File sharing is unchanged.** `stored_files` + thin per-revision pointer rows,
  carry-forward, copy-on-write and the stateless reference check all stay exactly
  as `document-system-plan.md` §3 specifies. This plan moves bytes on disk and
  rewrites path strings; it does not touch the sharing model.

---

## 1. Current state

| | Today |
| --- | --- |
| Images | `POST /api/upload/:target` → `uploads/{target}/{ts}-{rand}{ext}`. Flat, opaque names, no link back to the owner except the DB column. Targets: `part-categories`, `parts`, `products`, `sub-products`, `suppliers`, `documents`, `temp`. |
| Documents | `uploads/documents/{entityFolder}/{displayName}`, entity folder resolved by immutable `{id}-` prefix (`sub-{id}-` for sub-products) and **never renamed**. |
| `storage_key` | Relative to `uploads/documents` — `{folder}/{filename}`. |
| Serving | `app.use('/uploads', express.static(...))` in `server.ts`. |
| Deleting a product | DB cascades; **files are left on disk**, scattered across two trees. |

On disk today: 61 files. `uploads/_tmp/` exists but is referenced nowhere in
code. Two folders under `documents/` do not match the current convention:
`Termék-12-12ff433` (name first, no id prefix) and `sub-Altermék-1-alt33` nested
inside it.

---

## 2. Target layout

```
uploads/
  products/
    {id}-{Name-with-dashes}-{SKU}/
      image-{ts}.{ext}
      documents/
        <files shared across all product revisions>
      sub-products/
        {id}-{Name-with-dashes}-{SKU}/
          image-{ts}.{ext}
          documents/
            <files shared across all sub-product revisions>
  parts/
  part-categories/
  suppliers/
  _tmp/                      staging, see §4.2
```

- `storage_key` becomes relative to `uploads/products`, e.g.
  `12-Termek-12ff433/documents/factura.pdf` or
  `12-Termek-12ff433/sub-products/1-Altermek-alt33/documents/gerber.zip`.
- `publicPath()` returns `/uploads/products/{encoded key}`.
- `products.image` / `sub_products.image` store the same shape:
  `/uploads/products/12-Termek-12ff433/image-1784538441249.png`.
- `parts`, `part_categories`, `suppliers` are **not** product-owned and keep
  their existing flat folders and naming. Nothing about them changes.

### Why the image keeps a timestamp

Not `image.png`. Uploads are served statically and the browser caches the URL;
replacing a product image under a stable name would serve stale bytes until a
hard refresh. The timestamp makes every replacement a new URL.

---

## 3. Naming and resolution

Folder name at creation:
`{id}-{name with whitespace runs replaced by dashes}{-SKU if present}`, run
through the existing `sanitizeSegment()`.

`resolveEntityFolder()` keeps its current behaviour unchanged: match on the
immutable `{id}-` prefix, reuse whatever folder is found whatever its name
suffix, create one only when no prefix match exists. Renaming a product never
fragments it into two folders and never invalidates a `storage_key`.

This is the whole reason the design has no rename machinery. Nothing in the
application reads a folder name — the backend contains exactly one `readdirSync`
(this prefix match) and every other filesystem call derives its path from
`storage_key`. Folder names exist only for humans browsing the tree, so a stale
one is a cosmetic issue, not a correctness one, and is not worth a rename hook,
a transactional key rewrite and a compensating rollback on the hot path.

A sub-product can never move to a different product: `subProductPayloadSchema`
(used by PATCH) carries no `productId`, only `createSubProductSchema` does. So
`{id}-` prefix resolution is sufficient for the nested case too.

### 3.1 Keeping a drifted folder findable

Renaming a product leaves the folder under its old name. Rather than renaming on
disk, surface the name in the app:

- A read-only **"Files folder"** line on the product and sub-product detail
  pages showing the folder name, copyable. No backend logic — the name is
  already implied by `storage_key`, or derivable from any document's path.
- Optional, later: `npm run uploads:resync-names` — an offline maintenance
  script that renames drifted folders to canonical and rewrites the affected
  keys in one transaction. Same work as the rejected hot-path hook, but run
  deliberately when it bothers someone, with no request-time failure surface.

### 3.2 Rejected alternatives

**Rename folders on every rename.** Costs a hook on two PATCH routes, a
transactional prefix-rewrite of `stored_files` plus both `image` columns, and a
compensating rollback when the DB half fails — all to keep a string pretty that
no code reads. Deferred to the offline script above.

**Storing only the filename in `storage_key`** and resolving the folder at read
time. Renames would never touch the DB, but a `stored_files` row stops being
self-describing, and the cleanup path (`releaseStoredFile` returns a key the
caller unlinks after commit, with no other context) depends on the row alone
being enough to locate the file. Keeping the full path preserves that contract.

**Making name/SKU immutable** so folders can never drift. Rejected: it
constrains the domain model to serve a storage detail, and makes a typo at
creation permanent. If renames should be rarer, the proportionate lever is
permissions — `PATCH /api/products/:productId` currently requires only
`requireAuth` while the sub-product equivalent requires `requireAdmin`, which
looks like an oversight worth correcting on its own merits.

---

## 4. Code changes

### 4.0 New modules

| File | Role |
| --- | --- |
| `src/services/uploadPaths.ts` | Single source of truth for the tree: `productsDir`, `tmpDir`, `canonicalFolderName`, `{id}-` prefix resolution. Imported by the service, both scripts and the migration. |
| `src/services/entityImages.ts` | Staging → filing → cleanup for product / sub-product images. |
| `src/services/uploadMigration.ts` | Planning half of the migration, connection-injected so the mapping rules are testable. |
| `src/services/tmpSweeper.ts` | Removes abandoned `_tmp` files after 24h, skipping any still referenced by an `image` column. |
| `scripts/migrate-uploads.ts` | CLI: report → confirm → apply → prune. |
| `scripts/resync-upload-folder-names.ts` | Offline folder-name resync (§3.1). |

### 4.1 `backend/src/services/documentFiles.ts`

- `documentsDir` → `productsDir = path.join(process.cwd(), 'uploads', 'products')`.
- `SCOPES[*].folderPrefix` is removed (no more `sub-` prefix).
- `resolveEntityFolder(scope, entityId, name, sku)` → `resolveEntityDir(...)`
  returning the **documents** directory relative to `productsDir`:
  - product: `{p}/documents`
  - sub-product: `{p}/sub-products/{s}/documents`
  It therefore needs the parent product's `id`/`name`/`sku` for the sub-product
  case — `findEntityForRevision` gains those columns via a join on `products`.
- Prefix-matching and folder creation are otherwise **unchanged**.
- `publicPath()` and `resolveStoredFilePath()` re-root onto `productsDir`.
- New `removeEntityFolder(scope, ...)` — `fs.rm(recursive)` for the delete hooks.
- Temp uploads move out of the documents root (`tmp-` files currently land in
  `uploads/documents/`, which is a served directory) into `uploads/_tmp/`.

### 4.2 Image upload — `routes/uploadFiles.ts` + the two entity routes

The problem: `ImageUploadField` uploads immediately and binds the returned URL
into the form, so the file is written **before** the product row exists — and
`products.image` is `NOT NULL`, so there is no id to file it under yet.

Minimal fix that leaves the frontend almost untouched:

- `products` and `sub-products` are dropped from `UploadTarget`. Those two fields
  upload with `target: 'temp'` → `uploads/_tmp/{ts}-{rand}{ext}`.
- `POST /api/products` and `POST /api/sub-products`: after the insert, if
  `data.image` points into `/uploads/_tmp/`, move it into the (now known) entity
  folder and `UPDATE ... SET image` to the final path.
- The two `PATCH` handlers: same move when the image changed, then unlink the
  previous image file.
- Frontend change is one prop: `target="temp"` in `ProductModal.vue` and
  `SubProductModal.vue`. `uploadApi.ts` drops the two dead target literals.

**`_tmp` sweeper.** A form the user abandons leaves a file behind. Add a sweep of
`_tmp` entries older than 24h, run on boot and on an interval. Small, and without
it `_tmp` grows forever.

### 4.3 Delete hooks

`DELETE /api/sub-products/:spId` already cascades in the DB and leaves files
behind today. With one folder per entity it becomes a single `fs.rm` after the
transaction commits — same post-commit discipline as `unlinkStoredFile`. Products
are archived rather than deleted (`status`), so an archived product keeps its
folder.

### 4.4 Migration

- **`database/migrations/014-require-sub-product-parent.sql`** — delete the one
  known orphan, then `ALTER TABLE sub_products ALTER COLUMN product_id SET NOT NULL`.
- **`backend/scripts/migrate-uploads.ts`** — one-shot, idempotent, transactional:
  1. Read every product and sub-product, compute canonical folder paths.
  2. Move `uploads/products/{ts}-{rand}.png` → `{productFolder}/image-{ts}.png`,
     same for sub-product images, driven by the current `image` column value.
  3. Move `uploads/documents/{entityFolder}/*` into the new tree, resolving the
     entity by the **leading id in the folder name**, not by the name text.
  4. Rewrite `stored_files.storage_key`, `products.image`, `sub_products.image`.
  5. Commit, then remove the emptied `uploads/documents/` tree.

  Folders that do not match `^(\d+)-` — today `Termék-12-12ff433` and the
  `sub-Altermék-1-alt33` nested inside it — are **reported and the script
  aborts**. They get an explicit mapping passed in rather than a guess.

  Dry-run flag that prints every planned move and DB update without applying.
  Wired as `npm run uploads:migrate` alongside the existing `db:init` /
  `db:migrate` scripts, using the same `dotenv -e .env` wrapper.

- Delete the committed `.DS_Store` files and add `.DS_Store` to `.gitignore`.

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| Crash between the entity insert and the image move → `image` still points into `_tmp`, sweeper deletes it in 24h, image 404s | Do the move **before** the insert commits where possible, and have the sweeper skip files still referenced by an `image` column |
| Migration mis-maps a legacy folder | Abort on any folder not matching `^(\d+)-`; dry-run first; run against a DB dump |
| Two products sharing a SKU produce colliding folder names | Impossible — the `{id}-` prefix is unique regardless of name or SKU |
| `_tmp` grows unbounded | 24h sweeper (§4.2) |
| Folder name drifts after a rename | Accepted. §3.1 surfaces the name in the UI; optional offline resync script |
| Long nested paths on Windows-mounted volumes | Only relevant if the tree is ever synced to Windows; `{id}-` prefix keeps segments short enough in practice |

---

## 6. Order of work

1. Migration 014 (`product_id NOT NULL`) — independent, do it first.
2. `documentFiles.ts` re-rooting + `resolveEntityDir` + `removeEntityFolder`.
3. `migrate-uploads.ts` with dry-run; run dry, inspect, run for real.
4. Image upload flow (§4.2) — backend, then the two modals.
5. Delete hooks (§4.3) and the `_tmp` sweeper.
6. "Files folder" display (§3.1) — small, independent, can land any time.
7. Verify: every `stored_files.storage_key` resolves to an existing file, and
   every `products.image` / `sub_products.image` does too. A short script over
   both tables, run after the migration.

Steps 1 and 6 are independent of the rest and safe to land on their own. The
irreversible step is 3 — take a DB dump and a copy of `uploads/` first.

---

## 7. Runbook — dev and production

The code deploys safely **before** the migration runs: new uploads go to the new
tree, existing rows still point at the old paths, and nothing reads a folder
name. Migrate at your convenience after deploying.

Per environment, in order:

```bash
# 1. Back up. The migration moves files; there is no undo once it commits.
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
cp -a backend/uploads backend/uploads.bak

# 2. Enforce the sub-product parent (fails loudly if any orphan remains).
npm run db:migrate            # applies 014

# 3. Inspect the plan. Changes nothing.
npm run uploads:migrate -- --dry-run

# 4. Apply, after reading the report.
npm run uploads:migrate
```

Step 3 is the important one. Read the summary before answering `y`:

- **Unmappable** — a folder or image path whose owner cannot be derived. The run
  **aborts** on these rather than guessing. On dev this will list
  `Termék-12-12ff433`. Move those files into the right folder by hand and re-run,
  or pass `--skip-unmappable` to leave them where they are.
- **Source file missing** — a `stored_files` row whose file is not on disk. The
  path is rewritten anyway so the database stays internally consistent; the
  bytes were already gone.
- **Orphan files** — files under `uploads/documents/` with no row pointing at
  them. Left in place, never deleted. Review them after the run.

The migration is idempotent: a re-run after a partial failure resumes rather
than double-moving, because anything already in the new shape is skipped.

### Verifying afterwards

```sql
-- Both should return zero rows.
SELECT id, storage_key FROM stored_files WHERE storage_key NOT LIKE '%/documents/%';
SELECT id, image FROM products WHERE image NOT LIKE '/uploads/products/%/%'
UNION ALL
SELECT id, image FROM sub_products WHERE image NOT LIKE '/uploads/products/%/%';
```

Then open a product with documents and a sub-product image, and confirm both
render.

Note the second query also matches rows whose `image` is `''` — legacy rows
backfilled by migration 003, which predate the image requirement and have no
file to point at. To see only genuinely wrong paths, add `image <> ''`.

### Dev run, for reference

Three `stored_files` rows used the pre-`{id}-` naming (`Termék-12-12ff433`,
`sub-Altermék-1-alt33`) and were reported as unmappable. They were test data and
were deleted — files, then the `product_revision_documents` /
`sub_product_revision_documents` rows, then the `stored_files` rows, in that
order (`stored_file_id` is `NOT NULL REFERENCES stored_files(id)` with no
cascade). The remaining 9 documents and all images migrated cleanly.

`uploads/sub-products/` was left holding two images no row pointed at — orphans
from replacements under the old code, which updated the column but never deleted
the previous file. The folder is now gone; nothing writes there any more.
