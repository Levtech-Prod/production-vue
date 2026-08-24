# Document revision mode — design record

Supersedes `firmware-plan.md`. Firmware stops being a feature of its own and
becomes what it always was in substance: **one document type that happens to
keep versions.**

Written 2026-08-24, branch `LP-93-doc-revision`.

---

## 1. What changes

Today the Documents panel shows a grid of document type cards, each a flat
bucket of files, plus a separate highlighted **Firmware** bar that only appears
under a sub-product revision and opens a versioned view of its own.

After this change:

- The Firmware bar is gone. Firmware is a normal document type named
  "Firmware", created on one sub-product, with **revision mode** ticked.
- Any document type belonging to a single product or sub-product may have
  revision mode. A revision-mode card holds **versions** instead of loose
  files; each version carries a name, a status, release notes, its creator and
  its own file list — exactly what a firmware version carries today.
- Revision-mode cards live in their own section above the ordinary card grid.
  Clicking one swaps the right-hand panel to the versions view, with a back
  link, the same way the firmware bar does now.

## 2. Decisions

### Versions belong to the ENTITY, not to a product revision

This is the one place the new model deliberately departs from firmware.

Firmware versions hang off a `sub_product_revision`, so each revision of a
sub-product has its own separate firmware list. Document revisions are a
**separate axis**: a revision-mode card carries one version history belonging to
the product or sub-product itself, and selecting a different product revision in
the tree does not change what the card shows.

Consequence: a revision-mode document type can only be **entity-scoped** (added
from that product's / sub-product's own Documents panel, migration 016). A
type-scoped template is shared by every product of that type and so has no single
version history to own. The settings page therefore never offers the checkbox,
and a database CHECK backs that up.

### Everything else about a version is firmware's model, renamed

Statuses stay `testing` / `production` / `deprecated`, with **at most one
`production` per document type**, enforced by a partial unique index and by the
API demoting the incumbent in the same transaction. Name is unique per document
type, case-insensitively. Same-name file re-upload overwrites.

### Version files are never statically served

A revision-mode card with an empty `allowedExtensions` accepts **any**
extension — that is what firmware needs (`.uf2`, `.dfu`, vendor programmers) and
what the ordinary global upload allow-list would reject. Setting a list on the
card narrows it as usual.

That is only safe because these files are read back **exclusively** through the
authenticated download route. Their folders sit inside the statically served
product tree, so `server.ts` 404s any `/uploads/**` path with a `revisions` (or,
for files migrated from firmware, `firmware`) path SEGMENT, ahead of the static
mount. Three non-obvious requirements carried over from the firmware guard, all
still load-bearing:

- decode each segment before comparing (`express.static` decodes, so
  `%72evisions` would otherwise slip past),
- compare case-insensitively,
- match a segment, never a prefix — and never replace this with an allow-list of
  served subtrees, because `uploads/` also holds part, part-category and
  supplier images from `routes/uploadFiles.ts`.

Unlike a document, a version file response therefore carries only
`downloadUrl`, with no public `path`.

### Revision mode cannot be toggled over existing content

Turning it **on** for a type that already holds ordinary documents would hide
them; turning it **off** for a type that holds versions would strand them. Both
are rejected with a specific error code rather than silently permitted. Creating
a type with the checkbox already ticked is always fine.

## 3. Data model (migration 022)

```
product_document_types.revision_mode      BOOLEAN NOT NULL DEFAULT FALSE
sub_product_document_types.revision_mode  BOOLEAN NOT NULL DEFAULT FALSE
    CHECK (NOT revision_mode OR <entity>_id IS NOT NULL)

document_revisions
  id
  product_document_type_id      -> product_document_types(id)      ON DELETE CASCADE
  sub_product_document_type_id  -> sub_product_document_types(id)  ON DELETE CASCADE
      CHECK ((product_document_type_id IS NULL) <> (sub_product_document_type_id IS NULL))
  name, status, release_notes, created_by, created_at, updated_at

document_revision_files
  id, document_revision_id -> document_revisions(id) ON DELETE CASCADE
  storage_key (UNIQUE), original_name, size_bytes, mime_type, uploaded_by, created_at
```

One pair of tables with two mutually exclusive FKs rather than four parallel
tables: the two document-type families are already driven from one `ScopeConfig`
in `routes/documentTypes.ts`, and the only thing that differs here is which
column the scope writes. Partial unique indexes per family carry the name and
one-production rules, the same technique migration 016 uses.

`document_revisions` is keyed on the document type, and an entity-scoped type
belongs to exactly one product or sub-product — so the type id alone identifies
the owner and no second FK to the entity is needed.

### Storage

```
uploads/products/{product}/documents/revisions/{revId}-{Name}/
uploads/products/{product}/sub-products/{sub}/documents/revisions/{revId}-{Name}/
```

Staging is `uploads/_tmp/revisions/` — a `revisions` segment, so the guard that
hides stored files hides half-written ones too (`_tmp` itself is served).

`storage_key` is relative to `productsDir`, like a document's.

### Migrating the existing firmware

Per sub-product that owns any firmware, migration 022 creates (or reuses) an
entity-scoped `Firmware` document type with `revision_mode = TRUE` and the `cpu`
icon, then moves every firmware onto it:

- **Name collisions.** Firmware names were unique per *revision*; collapsing a
  sub-product's revisions into one list can produce duplicates, so a colliding
  name gains its old revision label, and — if that still collides — the old id.
- **Production collapse.** Several revisions could each hold a production
  firmware; only the newest survives as `production` and the rest become
  `deprecated`.
- **Files** keep their `storage_key` verbatim: nothing moves on disk, and the
  `firmware` path segment they contain keeps them unserved. New uploads land
  under `documents/revisions/`.

`firmware_files` and `firmwares` are dropped at the end. The whole data step is
guarded on the tables still existing, so a re-run is a no-op.

## 4. API

Replaces `routes/firmwares.ts` one-for-one, keyed on the document type instead
of a sub-product revision:

```
GET    /api/product-document-types/:id/revisions
POST   /api/product-document-types/:id/revisions
GET    /api/sub-product-document-types/:id/revisions
POST   /api/sub-product-document-types/:id/revisions
PUT    /api/document-revisions/:id
DELETE /api/document-revisions/:id
POST   /api/document-revisions/:id/files          (multipart, several at once)
DELETE /api/document-revision-files/:fileId
GET    /api/document-revision-files/:fileId/download
```

The Documents panel payload gains `revisionTypes` beside `documentTypes` — the
same card fields plus `versionCount` and `productionName`. Revision-mode types
are excluded from `documentTypes` so the two sections never show the same card
twice; both feed the summary counts, where a revision-mode card is `complete`
once it has at least one version.

Version changes keep writing the owning product's change log, under event types
`document_revision` / `document_revision_file` (the old `firmware` /
`firmware_file` labels stay in the i18n catalogue so historical rows still
render).

## 5. Files

Backend — removed: `routes/firmwares.ts`, `services/firmwareFiles.ts`,
`schemas/firmwares.schema.ts`. Added: `routes/documentRevisions.ts`,
`services/documentRevisionFiles.ts`, `schemas/documentRevisions.schema.ts`.
Changed: `routes/documentTypes.ts`, `routes/documents.ts`, `routes/subProducts.ts`
(a sub-product revision delete no longer sweeps firmware folders — versions are
not per revision any more), `services/uploadPaths.ts`,
`services/documentFiles.ts`, `services/tmpSweeper.ts`, `server.ts`,
`errorCodes.ts`.

Frontend — `views/products/detail/firmware/**` becomes
`views/products/detail/documents/revisions/**`; `types/firmware.ts` and
`api/firmwareAPI.ts` become `types/documentRevisions.ts` and
`api/documentRevisionsAPI.ts`. `DocumentsPanel.vue` gains the versioned section
and loses the firmware bar; `DocumentTypeFormModal.vue` gains the checkbox.
