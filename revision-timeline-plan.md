# Product Revision Timeline — Plan

> **Status: implemented except steps 3 and 8, and §8.2-§8.6.**
> Adds a **Változásnapló** view inside the Product detail page's *revíziós mód*,
> alongside the existing grid which is now called **Összeállítás**.
> Non-revíziós mód is not affected.
>
> Shipped: `revisionHelpers.ts`, `revisions/RevisionTimeline.vue`,
> `revisions/RevisionTimelineItem.vue`, `RevisionOverviewPanel.vue`,
> `revPanelView` in `useRevisionSelection.ts`, the segmented control in
> `ProductTree.vue`, capped header pills with the `+N további` popover,
> `created_by` on product revisions, and the derived diff (§8.7).
>
> **Decisions changed during implementation** — see §2.3, §2.5 and §8.7:
> the default revision is pinned to the top of both the timeline and the pills;
> the timeline entry carries label + status badge + date + author, and nothing
> else; change notes and the composition list live on the Áttekintés tab, which
> renders in revíziós mód only; and the derived per-revision diff was built and
> then removed.
>
> Not done: the `ProductTree.vue` extraction (step 3), the `⋮` actions menu
> (step 8), and the API/loading optimisations §8.2-§8.6.

Decisions locked in:

- **Revíziós mód's left panel becomes a timeline of product revisions.** The
  selected revision expands to show its composition (the sub-product revisions
  linked to it) as children.
- **Each timeline entry shows status + date + author + a change-notes snippet.**
  `product_revisions.created_by` already exists in `schema.sql` but is neither
  written nor selected — both get fixed. **No migration.**
- **Non-revíziós mód is left exactly as it is.** The flat list of sub-products
  linked to the active revision (`normalRows`) stays, and stays the default
  view. The redesign applies **inside revíziós mód only**.
- **The `Revíziók` toggle keeps its current meaning.** No new global mode, no
  rename of `revisionsMode`.
- **The right panel keeps its tabs** and gains an *Áttekintés* tab as the first
  one. Everything on it is optional relative to the timeline — the timeline is
  the deliverable.

---

## 1. What is wrong today

| Symptom | Cause |
| --- | --- |
| 13 revision pills wrap into four rows in the header and dominate the fold (`ProductOverviewCard.vue:57-77`). | Every revision is rendered, unranked. A product with 40 revisions renders 40 pills. |
| The same revisions are rendered **again** as chips inside the left tree in Revisions mode (`ProductTree.vue:113-152`). | Two controls, one piece of state (`activeProductRevId`). The user has to learn that they are the same thing. |
| Revíziós mód drops you into a grid of *every* sub-product × *every* revision, ordered by sub-product name. | The mode is named after revisions but is organised by sub-product. History is the one thing it cannot show. |
| A revision carries `changeNotes`, `createdAt` and a status, and **none of it is visible anywhere** on the page. | `GET /api/products/:productId` returns all three (`products.ts:212-219`); the UI renders only `label`. |
| Nothing on the page answers "what changed between Rev. 11 and Rev. 12". | The data to answer it is already loaded (`membership`) and simply never diffed. |

Revíziós mód answers *"which revisions exist?"* loudly and *"what actually
changed, when, and by whom?"* not at all. That inversion is the whole problem,
and it is contained entirely within that one mode — which is why the fix is too.

Non-revíziós mód is not part of the problem. It answers a different, narrower
question — *"what is in the revision I am looking at right now?"* — and it
answers it well. It is left alone.

---

## 2. Target layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ProductOverviewCard  — slim                                                 │
│  img  Termék 12 · 12ff433 · leírás      REVÍZIÓK  [Rev.13][Rev.12][Rev.11] │
│                                                    [★ Rev.1] [+9 további ▾] │
│  Típus · Revíziók 13 · Altermékek 10 · Alapért. Rev.1 · Létrehozva · Módos. │
└─────────────────────────────────────────────────────────────────────────────┘
NON-REVÍZIÓS MÓD — unchanged            REVÍZIÓS MÓD — new
┌── 20rem ────────────────┐             ┌── 20rem ─────────────────────┐
│ ◧ Áttekintés  [Revíziók]│             │ ◧ Áttekintés  [Revíziók]▣    │
│ ┌─────────────────────┐ │             │ ┌──────────────────────────┐ │
│ │ ▣ Termék 12  Rev.12 │ │   ── ▶ ──   │ │ ▣ Termék 12       Rev.12 │ │
│ └─────────────────────┘ │             │ └──────────────────────────┘ │
│ ALTERMÉKEK              │  [Revíziók] │ [Változásnapló][Altermékek]  │
│ ▣ Altermék 1    Rev. 2  │             │ Szűrés ▾          Legújabb ▾ │
│ ▣ Altermék 3    Rev. 1  │             │                              │
│ ▣ Altermék 7    Rev. 4  │             │ ●─┬ Rev. 13      ○ Draft     │
│                         │             │   │ 08.04 · Levente M.       │
│  (flat list of what is  │             │   │ +1 altermék · 2 változott│
│   in the active rev.)   │             │ ●─┼ Rev. 12 ★    ● Aktív  ◀──│
│                         │             │   │ 08.01 · Csongor T.       │
│                         │             │   │ "Firmware v2.14.3"    ⋮  │
│                         │             │   │  └ Altermék 1    Rev. 2  │
│                         │             │   │  └ Altermék 3    Rev. 1  │
│                         │             │ ●─┴ Rev. 11      ● Elavult   │
│                         │             │ [+ Új revízió]               │
└─────────────────────────┘             └──────────────────────────────┘
   header pills = the only                header pills = shortcut;
   revision selector here                 the timeline is the selector
```

Right panel is identical in both modes:
`[Áttekintés][Dokumentumok][Anyagjegyzék][Összehasonlítás]`.

Three rules make revíziós mód readable where it is not today:

1. **Revíziós mód is organised by revision, not by sub-product.** Today it is
   sorted by `sp.name` — the one axis a revision history must not use.
2. **Newest first.** Today revisions render in `revision_number ASC`, so the
   revision the user almost always wants is last. The timeline reverses this;
   the header pills follow.
3. **Composition is nested, not parallel.** A sub-product appears under the
   revision that contains it, so "what is in Rev. 12" is answered by looking at
   Rev. 12 instead of by decoding ten membership badges.

### 2.1 Header — capped pills

Show at most **4** pills (`PILL_LIMIT` in `ProductOverviewCard.vue`), ordered by
the same `pinnedOrder()` the timeline uses: default revision first, then newest.
The rest collapse into a `+N további ▾` button opening a popover with the full
remaining list, each row showing its status.

Three details that matter:

- **With exactly one revision over the limit, show it** rather than a `+1
  további` button that costs a click to reveal a single item.
- **The active revision always stays visible.** If it lives in the overflow it
  replaces the last pinned pill, so the selected pill never silently vanishes;
  the displaced revision moves into the popover.
- Outside clicks close the popover, following the `IconPicker.vue` pattern
  (document listener + `contains` check) rather than inventing a second one.

> This part matters more under the revised scope, not less. In non-revíziós
> mód the header pills are now the **only** revision selector on screen — the
> in-tree chips are gone and the timeline is one mode away — so the popover has
> to be a complete, ordered list, not a decoration.

### 2.2 Non-revíziós mód — unchanged

The main product block plus the flat list of sub-products linked to
`activeProductRevId` (`ProductTree.vue:232-295`, the `normalRows` computed)
stays exactly as it ships today: same rows, same selection behaviour, same
empty states, still the default view on page load.

The only change is internal: each row is extracted into a shared
`SubProductRow.vue` so the timeline's nested children (§2.3) render identically
instead of being a second hand-rolled copy of the same row.

### 2.3 Revíziós mód — the changelog tree

Vertical rail, one connecting line, one status dot per entry — the existing
`statusDot()` colours (`draft` slate, `active` emerald, `deprecated` amber) are
reused verbatim so nothing new has to be learned.

**Every entry is two lines. There is no expanded state.**

```
● Rev. 11  ★                 [Aktív]
  2026.07.28 · Levente M.
```

- Rail dot, label, default star, and a right-aligned status badge.
- `createdAt` (date only) · author, or `—` when the author is unknown.

Status is carried **twice**: the coloured rail dot (`statusDot()` — slate
`draft`, emerald `active`, amber `deprecated`) and the written badge
(`statusBadgeClass()`). Both come from `product_revisions.status`, a real
column (`schema.sql:151`, `CHECK (status IN ('draft','active','deprecated'))`,
default `'draft'`) that `EditRevisionModal.vue` already writes through
`PATCH /api/product-revisions/:revId`.

Change notes and the composition live on the Áttekintés tab (§2.5), which is
what selecting an entry opens.

> **Changed during implementation.** The first cut put change notes, a diff
> line and an expandable sub-product list inside each entry. That reproduced
> the original problem at a smaller scale: the left panel became the place
> where everything is read, and entries stopped being scannable. Two lines is
> the whole entry now; the right panel does the explaining.

Clicking an entry sets `activeProductRevId` **and** resets
`selection = { type: 'product' }` — without the reset, a sub-product chosen
under the previous revision stays selected and the right panel describes a
revision the timeline is no longer pointing at.

**Ordering: the default revision is pinned first**, then the rest in the chosen
sort order. `pinnedOrder()` in `revisionHelpers.ts` is shared with the header
pills so the two can never disagree. The pin holds in both sort directions — a
pin that moved when you flipped the sort would not be a pin.

**Header controls:** a `[Változásnapló | Altermékek]` segmented control (see
§2.4), a status filter (`Mind / Draft / Aktív / Elavult`) and a sort toggle
(`Legújabb elöl / Legrégebbi elöl`). Filter and sort are local `ref`s in the
timeline component — the full revision list is already in memory, so this is
pure client-side `computed`, no request.

**Footer:** `+ Új revízió`, which switches to the Altermékek view with
`composingRevision = true`.

**Collapsed rail** (the existing `collapsed` prop) keeps working: it renders
just the dots with the label on hover.

### 2.3.1 Three states, from two booleans

No new mode is introduced. The existing `revisionsMode` and `composingRevision`
already describe everything, plus one new view flag scoped to revíziós mód:

| `revisionsMode` | `revPanelView` | `composingRevision` | Left panel shows |
| --- | --- | --- | --- |
| `false` | — | — | **Today's flat linked-sub-product list. Untouched.** |
| `true` | `changelog` | `false` | **New:** the revision timeline |
| `true` | `subProducts` | `false` | Today's sub-product × revision list, read-only checkboxes + CRUD |
| `true` | `subProducts` | `true` | The same list, checkboxes live, composing toolbar |

Transitions:

- `Revíziók` toggle on → `revPanelView = 'changelog'` (the timeline is what
  revíziós mód means now).
- `+ Új revízió` → `revPanelView = 'subProducts'`, `composingRevision = true`.
- Cancel composing → back to `'changelog'`.
- `applyDefaults()` currently forces `revisionsMode = true` when a product has
  no sub-products, so `+ Új altermék` is reachable. Keep that, but land on
  `'subProducts'` — a product with no sub-products has no revisions either, so
  the timeline would be empty.

### 2.4 Revíziós mód — the Altermékek view

This is today's `ProductTree.vue` revisions-mode body, **unchanged in
behaviour**: every sub-product with all of its revisions, compose checkboxes,
per-row new/edit/delete, and the composing toolbar. It keeps doing both jobs it
does today — managing sub-products, and building a new revision's composition.

One thing is removed from it: the **product revision chips block**
(`ProductTree.vue:113-152`), because the timeline is now the revision selector
inside revíziós mód. With it go the `set-active-rev`, `edit-product-rev` and
`set-default-revision` emits, which move to the timeline entry's `⋮` menu.

> **Nothing is deleted from non-revíziós mód.** `normalRows` and its list stay.
> The only dead code this plan removes is the revision chips block above and
> the duplicate `membershipMap` in `ProductTree.vue` (§8.1).

### 2.5 Right panel — Áttekintés tab

`RevisionOverviewPanel.vue`. **Rendered in revíziós mód only** — it describes
the selected revision, so it has no job in normal mode, where the three
original tabs stay exactly as they were. `activeTab` defaults to `documents`;
a watcher moves it off `overview` when Revisions mode is switched off, so the
panel can never point at a tab that is no longer rendered.

This is where everything the timeline entry no longer shows now lives:

- Revision identity: label, status badge, default star.
- `Létrehozva` / `Létrehozta` / `Altermékek` / `Dokumentumok x/y`.
- Full `changeNotes` in a bordered block, `whitespace-pre-line` so multi-line
  notes survive.
- **Összeállítás** — the composition list. Rows are buttons that set
  `selection = { type: 'subProduct', … }`, which is how a sub-product revision
  is reached now that the timeline no longer expands.

Counts come free: sub-product count from `membership`, doc completeness from
`docs.summary` (`RevisionDocuments.summary`, already returned per revision).
**Part count was dropped** — the BOM loads lazily, so it would render a
misleading `0` before `useBomAndParts` resolves. A wrong number is worse than
no number.

When `selection.type === 'subProduct'`, the panel switches to that sub-product
revision: name, label, status, dates, notes. Author shows `—`, because
`sub_product_revisions.created_by` is still never written (§3.1b was scoped to
product revisions only).

**Szerkesztés** opens `EditRevisionModal` for whichever revision the panel is
describing — the product revision in product scope, the sub-product revision
otherwise. The panel emits `edit-product-rev` / `edit-sp-revision` with the same
names and payloads the tree already uses, so both entry points land on
`openEditProductRevision` / `openEditSpRevision` rather than growing a second
path into the modal. Hidden when `isArchived`.

The other two actions (`Alapértelmezettként`, `Új revízió ebből`) are **not**
on this tab yet — they still live in the Összeállítás view. Adding them here is
step 8.

---

## 3. Data changes

### 3.1 Backend — `backend/src/routes/products.ts`

**a. Return the author on the detail endpoint** (`products.ts:212-219`):

```sql
SELECT pr.id, pr.revision_number AS "revisionNumber", pr.label, pr.status,
       pr.change_notes AS "changeNotes", pr.created_at AS "createdAt",
       pr.created_by AS "createdById",
       u.username AS "createdByName"
FROM product_revisions pr
LEFT JOIN users u ON u.id = pr.created_by
WHERE pr.product_id = $1
ORDER BY pr.revision_number
```

`users.username` is the display column — there is no `users.name`. This is the
same column `resolveActor` (`backend/src/services/audit.ts:110-120`) reads, so
the timeline and the change log can never disagree about who did what.

Keep `ORDER BY revision_number` ascending — reversing happens in the timeline's
`computed`, so `applyDefaults()`'s `reduce` over `revisionNumber` and every
other consumer stay untouched.

**b. Populate `created_by` on insert** (`products.ts:328-337`). The column has
existed since the initial schema and has **never been written** —
`grep -rn "created_by" backend/src` returns nothing. Add it to the INSERT and
pass `req.user?.id`:

```sql
INSERT INTO product_revisions
  (product_id, revision_number, label, status, change_notes, created_by)
VALUES ($1, (…), $2, 'draft', $3, $4)
```

Do the same at **both** `sub_product_revisions` INSERTs in
`backend/src/routes/subProducts.ts` — line ~279 (the automatic `Rev. 1` created
with a new sub-product) and line ~459 (every later revision) — so the nested
rows can show an author too. Note that the detail endpoint's sub-product query
(`products.ts:236-253`) does not select `created_at` either; add it there in
the same pass if the nested rows should carry a date.

**No migration.** Both columns already exist and are nullable. Rows created
before this change render `—` for the author; that is correct and honest, and
the timeline must handle `createdByName === null` without collapsing the row.

### 3.2 Frontend types — `frontend/src/types/products.ts`

```ts
export interface ProductRevision {
  id: number;
  revisionNumber: number;
  label: string;
  status: RevisionStatus;
  changeNotes?: string | null;
  createdAt?: string;
  /** null for revisions created before created_by was populated. */
  createdByName?: string | null;
}
```

`SubProductRevision` gets the same two optional fields. Both are optional, so
nothing that constructs a `ProductRevision` today breaks.

### 3.3 What is deliberately *not* added

- No `released_at` / `closed_at` column. The reference screenshot's "Lezárva"
  has no equivalent in this data model; `createdAt` is the honest field.
- No per-revision aggregate endpoint for the timeline counts. Sub-product
  counts are derivable from `membership`, which is already in the payload;
  adding a query to save an array lookup would be premature.
- No new table. The timeline is a view over `product_revisions`, not a new
  entity.

---

## 4. Component split

| File | Change |
| --- | --- |
| `detail/revisions/RevisionTimeline.vue` | **new** — segmented control, filter, sort, the rail, footer. Owns `filter`/`sort` refs only; everything else is props/emits. |
| `detail/revisions/RevisionTimelineItem.vue` | **new** — one entry: dot, label, status badge, star, meta line, notes snippet, expanded composition children. |
| `detail/revisions/RevisionActionsMenu.vue` | **new** — the per-entry `⋮` (Szerkesztés / Alapértelmezettként / Új revízió ebből). Keeps the item component from growing three more buttons. |
| `detail/RevisionOverviewPanel.vue` | **new** — the Áttekintés tab. |
| `detail/tree/SubProductRow.vue` | **new (extracted)** — one sub-product row: thumbnail, name, SKU, linked-revision chip. Used by the untouched non-revíziós list *and* by the timeline's nested children, so the two can never drift apart. |
| `detail/tree/LinkedSubProductList.vue` | **new (extracted)** — `ProductTree.vue:232-295` + `normalRows`, moved out verbatim. Behaviour identical; this is a cut-and-paste, not a rewrite. |
| `detail/tree/CompositionList.vue` | **new (extracted)** — `ProductTree.vue:298-433`, the sub-product × revision list with checkboxes and CRUD. Also verbatim. |
| `detail/ProductTree.vue` | **becomes a shell**: header, collapsed rail, main product block, and a `<component :is>` picking one of the three bodies. Delete the revision-chips block (lines 113-152) and the duplicate `membershipMap`; drop the `set-active-rev`, `edit-product-rev`, `set-default-revision` emits. ~590 lines → ~200. |
| `detail/ProductOverviewCard.vue` | Cap the pill list, add the `+N további` popover, sort pills newest-first. |
| `ProductDetailView.vue` | Add the `overview` tab; pass `revPanelView` through. **Leave the grid at `20rem`** — a width that changes with the mode would make the toggle jump, and 320px fits the timeline entry fine. |
| `detail/composables/useRevisionSelection.ts` | Add `revPanelView: Ref<RevPanelView>` and set it in `toggleRevisionsMode` / `startNewRevision` / `cancelNewRevision` / `applyDefaults`. **`revisionsMode` is not renamed and not changed.** |
| `detail/types.ts` | Add `export type RevPanelView = 'changelog' \| 'subProducts';`. |

`usePanelScope`, `useDocuments` and `useBomAndParts` are **not touched at all** —
the selection shape (`{ type: 'product' }` / `{ type: 'subProduct', spId,
spRevId }`) is exactly what the timeline emits, so every downstream panel keeps
working with no changes.

### 4.1 Shared bits worth extracting

`statusDot()` is currently defined in `ProductTree.vue:583` and will be needed
by four components once the file is split. Move it to
`detail/revisionHelpers.ts` alongside:

- `statusBadgeClass()` — the `Draft / Aktív / Elavult` pill;
- `newestFirst(revisions)` — used by both the timeline and the header pills;
- `linkedRevOf(sp, membershipMap, productRevId)` — the "highest revision number
  wins" defensive lookup, currently written twice (`useRevisionSelection.ts:41-53`
  and `ProductTree.vue:554-571` as part of `normalRows`).

Extracting these is what makes "keep the old list *and* add the timeline"
cost almost nothing: both render the same rows from the same helpers.

---

## 5. i18n

New keys, both `en` and `hu` blocks in `frontend/src/i18n/index.ts`:

```
changelog / sub_products_view / filter / sort_newest / sort_oldest
all_statuses / status_draft / status_active / status_deprecated
created_by / no_change_notes / more_revisions ("+{n} további")
tab_overview / new_revision_from_this / revision_composition
parts_count / documents_progress ("{done}/{total} feltöltve")
diff_added / diff_removed / diff_changed  (§8.7 summary line)
```

**Nothing is renamed or removed.** `revision_mode` and
`product_revisions_title` both stay — the `Revíziók` toggle and the header
block keep their current labels.

---

## 6. Implementation order

Each step leaves the app working.

1. **Backend** — populate `created_by` on both revision INSERTs; add the users
   join + `createdByName` to the detail endpoint. Extend the two frontend
   interfaces. Nothing renders it yet.
2. **Helpers** — create `detail/revisionHelpers.ts` (§4.1) and point
   `ProductTree.vue` at it. Pure refactor, no visible change.
3. **Split `ProductTree.vue`** — extract `SubProductRow.vue`,
   `LinkedSubProductList.vue` and `CompositionList.vue` verbatim; the shell
   renders them exactly as before. **Nothing about the UI changes in this step**
   — that is the point. Ship it and confirm both modes still behave identically
   before anything new is built on top.
4. **Header pills** — cap + `+N további` popover + newest-first in
   `ProductOverviewCard.vue`. Ships independently; the fold is fixed on its own.
5. **Timeline, read-only** — `RevisionTimeline.vue` + `RevisionTimelineItem.vue`
   rendering the collapsed entries and emitting `set-active-rev`. Add
   `revPanelView` and the `[Változásnapló | Altermékek]` control; revíziós mód
   now opens on the timeline. Non-revíziós mód is untouched throughout.
6. **Nested composition** — expand the selected entry, rendering
   `SubProductRow.vue` children. Confirm Documents/BOM still follow selection.
7. **Diff summary line** — §8.7, derived client-side from `membership`. This is
   what makes it a changelog rather than a list.
8. **Revision actions** — `RevisionActionsMenu.vue` wired to the existing
   `openEditProductRevision` / `onSetDefaultRevision` / `startNewRevision`;
   delete the chips block from the shell.
9. **Áttekintés tab** — `RevisionOverviewPanel.vue`, added as the first tab and
   the default when `selection.type === 'product'`.
10. **i18n + cleanup** — both locales, delete dead keys, delete dead props.

Folded in from §8 (they are cheap and belong with the step they touch):

- step 1 also does **§8.2** (`Promise.all` the three independent queries) and
  **§8.3** (split the sub-products join in two).
- step 3 also does **§8.1** (single `membershipMap`) and **§8.5**
  (`clearDetail()` on product change).
- step 10 also does **§8.4** (in-place patch for the two scalar mutations,
  narrow `clearBomCache`).

Steps 1-7 deliver everything the request asks for. 8-10 are the optional layer.
Step 3 is the one to not skip: doing the extraction as its own no-op commit is
what keeps the untouched non-revíziós mód provably untouched.

---

## 7. Review checkpoints

- **Not overengineered?** Zero new tables, zero migrations, zero new endpoints,
  one new boolean-ish ref. Four new components are genuinely new; three more
  are cut-and-paste extractions that make one 592-line file into four focused
  ones. The state model (`activeProductRevId` + `selection`) is unchanged.
- **Is the duplication acceptable?** Non-revíziós mód and the timeline's
  expanded entry now both render a sub-product list. That is deliberate — they
  answer different questions — and it costs nothing because both render the
  same `SubProductRow.vue` from the same `linkedRevOf` helper. If they ever
  need to differ, that is a signal to re-read this line, not to fork the row.
- **Scale.** 40+ revisions: the timeline scrolls in `overflow-y-auto`, filter
  and sort are client-side over an already-loaded array, header pills are
  capped at 4. Nothing renders unbounded.
- **Empty states.** No sub-products → `applyDefaults()` opens revíziós mód on
  the **Altermékek** view, not the timeline (a product with no sub-products has
  no revisions to show). No change notes → the notes line is omitted, not
  rendered blank. No author → `—`.
- **Archived products.** `isArchived` must still hide `+ Új revízió`, the
  actions menu and every edit affordance, exactly as it does now.
- **Accessibility.** Status is never colour-only — every dot is paired with its
  text badge. Timeline entries are `<button>`s in a list, arrow-key navigable.
- **Regression risk.** Concentrated in step 3's extraction and in the emits the
  chips block used to own. Before merging, walk **both modes**: non-revíziós —
  switch revision from the header pills → the linked list updates, select a
  sub-product → docs + BOM follow; revíziós — timeline selects a revision →
  same, compose a new revision → save, delete a sub-product revision that is
  currently selected → falls back to product scope, cancel composing → returns
  to the timeline.

---

## 8. Optimisations found while planning

These are independent of the timeline — they are pre-existing issues the
redesign either exposes or makes worse. Each is listed with whether it should
be done *as part of* this work or separately.

### 8.1 `membershipMap` is computed twice, and the timeline would make it three

`useRevisionSelection.ts:29-39` and `ProductTree.vue:505-516` contain the
**same** `productRevisionId -> Set<subProductRevisionId>` reduction, copy-pasted.
`linkedRevOf` / `normalRows` duplicate each other's "highest revision number
wins" defensive logic too.

**Do it as part of step 3.** `useRevisionSelection` already exports
`membershipMap`; pass it into the split components as a prop and delete the
local copy. This is a direct violation of the project's anti-duplication rule
today, and splitting `ProductTree.vue` without fixing it would turn two copies
into four.

### 8.2 The detail endpoint runs four sequential queries that could be two

`products.ts:199-253` awaits four `query()` calls in series. Queries 2-4
(revisions, membership, sub-products) depend only on `productId` — nothing in
them reads query 1's result except the 404 guard.

```ts
const productResult = await query(/* … */);
if (productResult.rowCount === 0) return res.status(404)…;

const [revisionsResult, membershipResult, subProductsResult] =
  await Promise.all([query(/* … */), query(/* … */), query(/* … */)]);
```

Four round trips become two. **Cheap, low-risk, do it in step 1.**

### 8.3 The sub-products payload duplicates every column per revision

`products.ts:236-253` is a flat `LEFT JOIN`, so a sub-product's `name`, `sku`,
`type`, `image` and `description` are repeated once **per revision**. Your
screenshot's product has 10 sub-products; at ~13 revisions each that is ~130
rows carrying ~10 rows' worth of actual sub-product data. The `image` and
`description` columns are `TEXT`, so this is real bytes, and the code then
un-duplicates it again in JS (`products.ts:257-274`).

Split into two parameterized queries inside the same `Promise.all`:

```sql
SELECT id, name, sku, type, image, description
  FROM sub_products WHERE product_id = $1 ORDER BY name;

SELECT id, sub_product_id AS "subProductId", revision_number AS "revisionNumber",
       label, status, change_notes AS "changeNotes", created_at AS "createdAt"
  FROM sub_product_revisions
 WHERE sub_product_id = ANY($1::int[]) ORDER BY sub_product_id, revision_number;
```

Group by `subProductId` in JS — simpler than the current `Map` dance, and the
payload stops growing as the product of two dimensions. **Worth doing**, because
§8.4 means this payload is fetched constantly.

### 8.4 `reload()` refetches everything after every mutation — 10 call sites

`ProductDetailView.vue` awaits `reload()` in **10** places, including after
renaming a revision label and after setting the default revision. Each one
re-reads the product, all revisions, the full membership table and every
sub-product revision — then `reload()` additionally calls `clearBomCache()`,
throwing away every cached BOM even when the mutation could not have touched a
BOM.

Two of these mutations are provably scalar — they change one row's own columns
and cannot alter membership:

| Handler | Endpoint | Actually changes |
| --- | --- | --- |
| `onSetDefaultRevision` | `PATCH /products/:id/default-revision` | `products.default_revision_id` |
| `onEditRevisionSaved` (productRev branch) | `PATCH /product-revisions/:revId` | that revision's `label` / `status` / `changeNotes` |

Both endpoints already return the updated row, and the frontend already
discards it. Patching `store.detail` in place for these two removes the two
most frequent full refetches on a page whose whole point is now editing
revisions.

**Recommendation: do these two, and only these two.** `useDocuments`'
refetch-don't-patch comment (`useDocuments.ts:39-41`) is right for anything
that can cascade — composition changes, deletes, sub-product saves — and those
should keep calling `reload()`. Scoping `clearBomCache()` out of `reload()` and
into only the handlers that change composition is a free second win.

### 8.5 A stale product renders during navigation

`watch(productId)` (`ProductDetailView.vue:749-757`) resets selection and
clears caches, but `store.detail` keeps the **previous** product until
`fetchDetail` resolves — so the overview card briefly shows the old product's
name, image and revisions under the new URL. `clearDetail()` exists in the
store (`productsStore.ts:113-115`) and is **never called anywhere**. Call it in
the watcher. One line; this gets more visible once the left panel is a dense
timeline. **Do it as part of this work.**

### 8.6 Per-revision document completeness needs no new query

Worth stating explicitly, since it is the obvious thing to over-build: the
Áttekintés panel's `Dokumentumok x/y` comes from `docs.summary`, which
`GET /api/documents/…` already returns per revision (`documents.ts:198-202`)
and `useDocuments` already caches per scope. **Do not** add a per-revision
aggregate endpoint to put completeness badges on every timeline row — that
trades a free lookup for a query, to decorate rows the user is not looking at.

### 8.7 Derived per-revision diff — built, then removed

> **Removed on request.** `diffAgainstPrevious()` was implemented and shipped,
> then deleted along with its i18n keys when the "changes vs. previous
> revision" section was cut from the Áttekintés tab. The reasoning below is
> kept because the mechanism is sound and costs no API work — if a
> what-changed view is ever wanted, this is how to build it. Recovering the
> function means restoring it from git history, not rewriting it.


The single biggest upgrade available, and it needs **no API work at all**.

`membership` already contains every revision's full composition, and
`subProducts` maps every `subProductRevisionId` back to its `subProductId`. So
the diff between consecutive product revisions is derivable entirely on the
client:

- id in Rev N but not Rev N-1, and its sub-product is absent from N-1 → *added*
- id in Rev N-1 but not Rev N, sub-product absent from N → *removed*
- same sub-product in both, different revision id → *changed* (`Rev. 1 → Rev. 2`)

One `computed` over data already in memory turns each timeline entry from
*"a revision exists here"* into *"3 altermék változott · 1 hozzáadva"*, with
the detail expandable inline. That is what makes it a changelog rather than a
list, and it is exactly what the reference screenshot's left rail implies.

The existing `GET /api/product-revisions/compare?a=&b=` stays for the Compare
tab's full part-level diff; it is not needed for this summary line.

Superseded — see the note at the top of this section.

### 8.8 Not worth doing

- **Caching `detail` per product id in the store.** Products are navigated to
  from a list, rarely back-and-forth, and the payload changes on every
  mutation. Adds an invalidation problem to solve a problem nobody has.
- **Paginating the timeline.** Filter + sort over an in-memory array covers
  40 revisions fine. Revisit past a few hundred, which this data model will not
  reach.
- **A dedicated changelog endpoint.** Everything the timeline renders is either
  already in the detail payload or (§8.7) derivable from it.
