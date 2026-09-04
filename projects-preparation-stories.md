# Projects Preparation — Jira epic and stories

## Epic

**Title:** Projects Preparation

**Description:**

> A new module for running a job from order to shop floor. A *project* is a
> named job containing one or more main products at pinned revisions; starting
> it freezes the combined bill of materials and splits every part into what can
> be picked from stock and what has to be bought.
>
> Four pages under a new "Projects Preparation" menu group: **Projects** (a
> Kanban board over the project's own parts, plus its full parts list),
> **Offer Processing** (request and compare supplier quotes side by side, then
> order), **Orders** and **Preparation**.
>
> Phases 1–2 deliver Projects and Offer Processing, through to placing an order
> at a supplier. Orders, Preparation and the project detail page are designed
> for and scheduled as phase 3.
>
> Available to all logged-in users — this is sales and warehouse work, not
> configuration.
>
> Design: `projects-preparation-plan.md` in the repo root. Stories: 0–15 for
> phases 1–2, 16–18 for phase 3.

---

## Stories

Derived from `projects-preparation-plan.md`. One story per step in §7 of that
plan, in dependency order.

**Each description is written to be pasted into a new Claude chat as the
implementation prompt.** They deliberately do not repeat the design — they
point at the plan sections that hold it, so the plan stays the single source of
truth and a story never drifts from it.

Branch names follow the existing convention: `LP-<jira number>-<topic>`.

**Permissions are settled (§8.5): the whole module is available to every
logged-in user.** No `requireAdmin` anywhere in these stories, and no new role.
One existing endpoint changes to make that true — see story 11.

**Decisions still open** (§8 of the plan) are called out on the story where
they must be answered. Two remain: §8.1 *Prepared* column semantics and
§8.4 stopping a project with open orders. Neither blocks the migration.

---

## 0. Spike: validate the BOM freeze query against real data

**Type:** Spike · **Blocks:** everything · **Estimate:** half a day · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3.4 before
> starting. Follow `CLAUDE.md`.
>
> This is a throwaway verification, not a feature — write no application code.
>
> Take the `WITH usage AS (...)` freeze query in §3.4 and run its read-only
> half (the `usage` CTE plus the two aggregations) against a copy of the
> production database, for a product that really exists and really has several
> sub-products. Do it for a hypothetical project containing two different
> products with quantities > 1.
>
> Report: the per-usage rows, the per-product totals, and the per-project
> `required_qty` per part. Flag anything surprising — parts appearing in more
> sub-products than expected, revisions with no parts at all, quantities that
> look wrong, sub-product revisions linked to a product revision more than
> once.
>
> The point is to find out whether the two-level aggregation matches what a
> person who knows the product would write down by hand. Everything else in the
> epic sits on top of this query being right.

---

## 1. Projects Preparation: database schema and error contract

**Type:** Story · **Blocked by:** 0 · **Estimate:** 1 day · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3 in full
> (§3.1–§3.6) plus §5.5. Follow `CLAUDE.md` — schema changes go through
> `backend/database/migrations`, never a manual `schema.sql` edit alone.
>
> Create `backend/database/migrations/023-add-projects.sql` containing every
> table, index and constraint defined in §3: `projects`, `project_products`
> (including the `UNIQUE (id, product_id)` index on `product_revisions` that
> its composite FK needs), `project_parts`, `project_part_usages`,
> `project_offer_companies`, `project_offer_prices`, `orders`, `order_lines`.
>
> Mirror the same definitions into `backend/database/schema.sql` in the same
> commit, in the style already used there — idempotent statements, `CHECK`
> constraints rather than Postgres enums, no triggers or functions.
>
> Then add the error codes listed in §5.5 to `backend/src/errorCodes.ts` and an
> `errors.<CODE>` entry for each in `frontend/src/i18n/index.ts`, in both
> English and Hungarian. Doing this now stops every later story inventing its
> own ad-hoc messages.
>
> Acceptance: `npm run db:migrate --prefix backend` succeeds on a fresh
> database and again on a second run without error; a database created from
> `schema.sql` alone has the identical structure; no application code changes.

---

## 2. Projects Preparation menu group and routing

**Type:** Story · **Blocked by:** 1 · **Estimate:** 1 day · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §6.1. Follow
> `CLAUDE.md`.
>
> `frontend/src/components/Sidebar.vue` currently renders a flat list of items
> with optional section headings and has no nested group. Extend the existing
> item shape with an optional `children` array rather than forking the
> component, and add the "Projects Preparation" group with its four entries.
>
> Register the routes from §6.1 in `frontend/src/router/index.ts`, including
> the `/projects-preparation` → `/projects-preparation/projects` redirect —
> that redirect is how "clicking the group opens Projects by default" is
> implemented, not a click handler. The group auto-expands when the current
> path starts with its root; keep the manual open/closed state in `uiStore`
> next to `sidebarCollapsed`.
>
> Only Projects and Offer Processing get routes. **Orders and Preparation
> appear in the menu disabled and tooltipped, with no route and no view** —
> do not create placeholder components (see §11.4). They become real links in
> stories 16 and 17.
>
> Add a minimal `ProjectsView.vue` and `OfferProcessingView.vue` so the two
> live routes resolve; they will be filled in by later stories.
>
> Ship this on its own — it is the only change in the epic that touches shared
> chrome, and it reviews much more easily apart from feature work.
>
> Acceptance: the group appears, clicking it lands on Projects, the collapsed
> sidebar still behaves like every other item, and the two disabled entries are
> visibly not-yet-available rather than broken links.

---

## 3. Stock availability and reservation service

**Type:** Story · **Blocked by:** 1 · **Estimate:** 1 day · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §4.2. Follow
> `CLAUDE.md`.
>
> Create `backend/src/services/projectStock.ts` exposing available and reserved
> quantities per part, using exactly the two queries in §4.2. Both take an
> array of part ids and answer in one round trip — never one query per part.
>
> "Available" is the existing FIFO rule (`quantity - quantity_consumed` over
> `type = 'received'` stock entries); do not reimplement it differently from
> `frontend/src/utils/stock.ts`. "Reserved" is the outstanding claim of *other*
> started projects: `SUM(from_stock_qty + received_qty - prepared_qty)`.
> Read the paragraph in §4.2 about why there is no reservations table before
> deciding to add one.
>
> Also expose a helper for free stock (`available - reserved`) since both the
> freeze and the Parts table need it.
>
> Acceptance: unit-level verification against seeded data covering a part with
> no stock, a part fully consumed, and a part claimed by two started projects
> one of which is stopped.

---

## 4. Projects CRUD API

**Type:** Story · **Blocked by:** 1 · **Estimate:** 2 days · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3.1, §3.2,
> §4.1, §5.1, §5.2 (Projects table only), §5.6. Follow `CLAUDE.md` — Zod at the
> boundary, parameterised SQL, consistent error shape, no `any`.
>
> Create `backend/src/routes/projects.ts` and
> `backend/src/schemas/projects.schema.ts`, register the router in
> `server.ts` alongside the existing ones, and implement list, create, read,
> update and delete per §5.2.
>
> The list endpoint returns the board payload of §4.1 — the counts query plus
> the membership rules derived from it in the API, not in SQL — and supports
> the `status` and `q` filters described there and in §6.3.
>
> Edit and delete are refused unless `status = 'draft'`
> (`409 PROJECT_NOT_EDITABLE`). Start and Stop are **not** in this story.
>
> Log create / update / delete through the existing
> `backend/src/services/audit.ts` with entity `project`; reuse `diffFields`,
> do not add audit machinery.
>
> **Permissions (§8.5, settled):** every endpoint in this story and in the rest
> of the epic is `requireAuth` only. Do not add `requireAdmin` to anything, and
> do not add a role column — the module is for all logged-in users.
>
> Acceptance: a project can be created with several products at pinned
> revisions, edited and deleted while draft; the board endpoint returns
> per-column counts; a revision belonging to a different product is rejected.

---

## 5. Projects board UI

**Type:** Story · **Blocked by:** 2, 4 · **Estimate:** 3 days · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §6.2, §6.3,
> and §4.1 for what the board payload means. Follow `CLAUDE.md`.
>
> Build the Projects page without its Parts table: `projectsStore`,
> `projectsAPI`, `types/projects.ts`, and the components listed under
> `views/projects/` and `views/projects/board/` in §6.2.
>
> Five columns per §4.1. Cards are read-only tiles and are **not draggable** —
> the column is a fact about the data (decision 2 in §1). Each card shows its
> column's count so a project visibly progresses. Selecting a project in the
> first column dims the others rather than hiding them.
>
> Edit / Delete / Start are offered on the Projects-column card while the
> project is draft, Stop while it is started. Use the existing
> `composables/useConfirmDelete.ts` unchanged for both confirmations, with
> `DeleteConfirmModal` / `ConfirmModal` — do not rename or copy it (§11.4).
>
> `ProjectModal` and `ProjectProductsEditor` add products at a chosen revision
> and quantity, defaulting to the product's `default_revision_id`. Before
> writing the product search-and-add list, look at
> `views/products/detail/AddPartsModal.vue` and `views/products/PartsPicker.vue`
> — reuse or widen if either fits.
>
> Include the status filter and name search from §6.3; the board defaults to
> draft + started.
>
> **Decision needed during this story: §8.1 (what *Prepared* means).** The plan
> makes it all-lines-done. Because membership is derived in the API and nothing
> is stored, this can be changed at any time — decide it while looking at real
> cards, not before.
>
> Acceptance: create, edit and delete a draft project with several products;
> Start and Stop are wired to endpoints that do not exist yet, so leave them
> disabled with a note rather than calling a missing route.

---

## 6. Project BOM computation and the Parts endpoint

**Type:** Story · **Blocked by:** 3, 4 · **Estimate:** 2 days · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3.4 (in
> full — the worked example matters), §5.3 and §5.4. Follow `CLAUDE.md`.
>
> Create `backend/src/services/projectBom.ts` and export
> `computeProjectBom(projectId)`: the read-only, in-memory flatten described in
> §5.3, using the aggregation of §3.4 against each product's **pinned**
> revision. It writes nothing.
>
> Add `GET /api/projects/:id/parts` returning the payload in §5.4. For a
> **draft** project it serves the computed rows with `draft: true` and the
> progress buckets at zero; for a started project it reads `project_parts` and
> `project_part_usages`. One payload shape either way — the frontend must not
> branch on which it got beyond showing the draft notice.
>
> Free stock comes from `services/projectStock.ts` (story 3), read once for all
> part ids in a single query.
>
> This deliberately comes before Start: it is the harder half of the logic, it
> is testable on a draft with no state to unwind, and the next story just
> persists what it produces.
>
> Acceptance: for a project with two products sharing a part across three
> sub-products, `required_qty` matches the hand calculation from the story-0
> spike; the `products` array collapses usages to distinct products and its
> `qtyForProduct` values sum to `requiredQty`.

---

## 7. Start and stop a project

**Type:** Story · **Blocked by:** 6 · **Estimate:** 2 days · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3.3, §5.3
> (the `freezeProjectBom` part) and §5.2. Follow `CLAUDE.md`.
>
> Add `freezeProjectBom(client, projectId)` to `services/projectBom.ts` and the
> `POST /api/projects/:id/start` and `POST /api/projects/:id/stop` endpoints.
>
> Start runs in one transaction: re-run `computeProjectBom` **inside** it (never
> trust quantities the browser sends back), insert `project_parts` and
> `project_part_usages`, seed `from_stock_qty` / `missing_qty` per §5.3, leave
> `ordered_qty` / `received_qty` / `prepared_qty` at zero, set
> `status = 'started'` and `started_at`. Take a `pg_advisory_xact_lock` on a
> fixed key so two simultaneous starts cannot both claim the last of a part.
>
> Refuse a project with no products or whose revisions yield no parts
> (`PROJECT_HAS_NO_PARTS`).
>
> Stop sets `status = 'stopped'` and `stopped_at`. Stock claims are released
> implicitly, because a stopped project drops out of the §4.2 aggregate —
> there is nothing to clean up.
>
> **Decision needed before this story: §8.4 (stopping a project with open
> orders).** Orders do not exist until story 15, but the shape of the stop
> endpoint depends on the answer: leave orders alone, prompt to cancel them, or
> refuse to stop. Decide now and note it; the branch that actually touches
> orders lands in story 15.
>
> Enable the Start and Stop buttons left disabled by story 5.
>
> Acceptance: starting a project populates the frozen tables and lights up the
> derived board columns; starting twice is refused; editing or deleting a
> started project is refused.

---

## 8. Edit purchase quantities and recalculate from stock

**Type:** Story · **Blocked by:** 7 · **Estimate:** 1 day · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3.3 (the
> quantity buckets and their CHECKs), §5.2 and §5.3 (`reseedFromStock`). Follow
> `CLAUDE.md`.
>
> Implement `PATCH /api/projects/:id/parts/:projectPartId` accepting
> `missingQty` and `fromStockQty`. Started projects only. `missingQty` must be
> clamped to at least `ordered_qty` — reject with
> `409 MISSING_QTY_BELOW_ORDERED` otherwise, so a line can never owe less than
> it has already bought. Set `missing_qty_overridden` when the user types over a
> seeded value.
>
> Implement `POST /api/projects/:id/parts/recalculate` backed by
> `reseedFromStock`: recompute free stock and rewrite `from_stock_qty` /
> `missing_qty` for rows that are **not** overridden, never dropping
> `missing_qty` below `ordered_qty`, and return both the rows changed and the
> rows skipped so the UI can explain itself.
>
> Log missing-quantity overrides through the audit service — that is the field
> a purchasing dispute will be about.
>
> Acceptance: an override survives a recalculate; a non-overridden row follows
> stock; lowering missing below ordered is refused by the API, not only the UI.

---

## 9. Project parts table

**Type:** Story · **Blocked by:** 5, 8 · **Estimate:** 3 days · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §6.4, §5.4 and
> §4.2 (for what the shortfall flag means). Follow `CLAUDE.md`.
>
> Build `ProjectPartsTable.vue` under the board, fed through the existing
> `composables/useScopedCache.ts` keyed on the selected project — that
> composable exists for exactly this "panel follows the selection" shape; read
> its header before writing any caching of your own.
>
> Columns and behaviour per §6.4, including the read-only Ordered and Received
> columns, the editable Missing quantity, the category search, the stock
> shortfall warning and the "Recalculate from stock" button.
>
> Add `frontend/src/composables/useTableSort.ts` for the column sorting and use
> it here; it is also used by the offer grid in story 12. Do **not** refactor
> the existing sort in `views/parts/PartsTable.vue` into it — that one sorts by
> a category-parameter id and is a different decision that merely looks similar
> (see the duplication rule in `CLAUDE.md`).
>
> A draft project shows the same table read-only with the "not started —
> quantities are indicative" notice (§6.3). Nothing is selected → the table is
> hidden.
>
> Acceptance: the Projects page works end to end as specified, for drafts and
> started projects alike.

---

## 10. Extract the shared PDF document helper

**Type:** Task (refactor) · **Blocked by:** — · **Estimate:** half a day · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §7 step 11 and
> §11.5. Follow `CLAUDE.md`.
>
> `frontend/src/views/products/detail/bom/bomPdf.ts` holds two things the offer
> export will also need: the Roboto font registration (jsPDF's built-in fonts
> cannot render ő and ű) and the thumbnail rasteriser. Move both into
> `frontend/src/utils/pdfDoc.ts` and point `bomPdf.ts` at it.
>
> Behaviour must not change. This touches a **working, shipped** feature, so do
> it in its own commit and verify by exporting a product BOM containing
> Hungarian part names before and after and comparing the output.
>
> Acceptance: the existing BOM PDF export is byte-for-byte equivalent in
> appearance; no other file changes.

---

## 11. Offer processing API

**Type:** Story · **Blocked by:** 8 · **Estimate:** 3 days · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3.5 and §5.2
> (Offers section, including the two `DISTINCT ON` reference-price queries).
> Follow `CLAUDE.md`.
>
> Create `backend/src/routes/projectOffers.ts` and its Zod schemas: the offer
> queue, the grid read, add/remove company column, and the bulk price upsert.
>
> Prices are stored canonically in EUR with the same
> `entered_amount` / `entered_currency` / `rate_used` / `rate_date` provenance
> as `stock_entries`, converted through the existing
> `services/exchangeRates.convertToEur`. A cleared cell deletes its row; zero is
> a real price, not "no quote".
>
> The grid read also returns `referencePrice` per row — last price actually
> paid for the part, falling back to the newest quote from another project.
> Two `DISTINCT ON` queries over all the page's part ids at once, never per row.
>
> Removing a company column is refused with `OFFER_COMPANY_IN_USE` when an
> order for this project already exists at that company.
>
> **Also in scope — one change to an existing route (§8.5, settled).**
> `POST /api/companies` is currently `requireAuth, requireAdmin`, which would
> stop a salesman adding a supplier that is not in the list yet — something the
> offer grid in story 12 depends on. **Relax it to `requireAuth`.** Leave
> `DELETE /api/companies/:id` admin-only: creating a supplier name is harmless
> and reversible, removing one that stock entries and orders point at is not.
> While there, check `frontend/src/views/parts/AddStockForm.vue` — if its
> inline company creation is hidden behind an admin check, drop that too so the
> two screens behave the same.
>
> Acceptance: a project's to-buy lines come back with per-company prices and a
> reference price; a whole column of prices round-trips in one request.

---

## 12. Offer processing grid

**Type:** Story · **Blocked by:** 9, 11 · **Estimate:** 4 days · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §6.5 (all of
> it) and §6.2 for the file layout. Follow `CLAUDE.md`.
>
> Build the Offer Processing page: project list on the left (newest first,
> single select), price grid on the right behind `useScopedCache`.
>
> Fixed columns per §6.5 — image, part name, SKU, editable quantity, and the
> greyed reference price. **The image, name and SKU columns are sticky**; past
> three or four companies the grid scrolls sideways and a price typed into the
> wrong row is worse than no price. Dynamic columns come from
> `project_offer_companies`, one per company, added through `OfferCompanyModal`
> over the existing `companiesStore`.
>
> The editable quantity is the *same* `missing_qty` the Projects page edits —
> `PATCH /api/projects/:id/parts/:id`, one number shown on two screens. Money
> cells follow `PriceInput.vue` and flush in a batched `PUT` on blur, never per
> keystroke.
>
> Also in scope, because all three are cheap now and retrofit badly:
> keyboard navigation (Enter/↓ down the column, ↑ up, Tab across, Esc reverts),
> best-price highlighting (`MIN` over non-null cells, ties all highlighted,
> computed in the component), per-column sorting via `useTableSort` with nulls
> last in both directions, and the per-company footer showing quoted coverage
> and basket total.
>
> Excel paste is story 13 — leave it out here.
>
> Acceptance: quotes from three companies can be entered and compared on a real
> project's to-buy list; the reference price is visibly not an offer and is
> excluded from best-price.

---

## 13. Paste a price column from a spreadsheet

**Type:** Story · **Blocked by:** 12 · **Estimate:** 1 day · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §6.5, the
> paste bullet. Follow `CLAUDE.md`.
>
> Handle `paste` on a company column in the offer grid: split the clipboard
> text on newlines, map the values onto the rows **in their current sort
> order** starting at the focused cell, skip blanks, accept both `1,23` and
> `1.23`, and show a preview ("47 prices will be written, 3 rows skipped as
> non-numeric") before committing the whole lot in one `PUT`.
>
> Its own story on purpose. Suppliers answer an RFQ with a spreadsheet, and
> without this someone retypes two hundred prices per company per project and
> will quietly keep doing the whole job in Excel instead. Folded into story 12
> it would be the first thing cut under time pressure.
>
> Acceptance: a column copied from a real supplier spreadsheet lands correctly,
> including when the grid is sorted by something other than the default.

---

## 14. Export the offer table to PDF

**Type:** Story · **Blocked by:** 10, 12 · **Estimate:** 2 days · **Model:** Sonnet 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §6.5 (export
> bullet). Follow `CLAUDE.md`.
>
> Add a selection checkbox column to the offer grid, all rows checked by
> default, and an Export PDF button. Write
> `views/projects/offers/offerPdf.ts` on top of the shared `utils/pdfDoc.ts`
> from story 10 — do not copy the font or thumbnail code. Landscape, one column
> per company, part thumbnails included.
>
> Reuse the save flow the BOM export already uses
> (`composables/useFileSave.ts`, `useBomPdfExport.ts` as the model).
>
> Acceptance: a PDF with Hungarian part names renders correctly; deselected
> rows are absent; the reference-price column is not exported.

---

## 15. Order parts from the offers

**Type:** Story · **Blocked by:** 12 · **Estimate:** 3 days · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §3.6, §5.2
> (`POST /api/projects/:id/orders`) and §6.5 (the Order Parts bullet). Follow
> `CLAUDE.md`.
>
> Implement `POST /api/projects/:id/orders`: group the submitted lines by
> company, create one `orders` row per company — so one click can place three
> orders at three suppliers, which is the whole point — copy the accepted price
> onto each `order_lines` row, and **add** each quantity to
> `project_parts.ordered_qty` rather than assigning it, so a part can be ordered
> across several orders over time. Reject a line that would push `ordered_qty`
> past `missing_qty`.
>
> Add the thin read endpoints `GET /api/orders?projectId=` and
> `GET /api/orders/:id` — enough to prove the write landed; the Orders page is
> story 17.
>
> Build `OrderPartsModal`: the selected rows with a company dropdown each,
> pre-selected to the best price, a footer grouping the resulting orders by
> company with totals, one POST on confirm. Fully ordered lines leave the grid;
> a partly ordered line stays, showing its remainder.
>
> **§8.4 lands here.** Implement whatever was decided in story 7 about stopping
> a project that has open orders.
>
> Acceptance: a part short by 8 can be ordered 3 from one supplier and 5 from
> another, in two separate actions, with the remainder visible in between; the
> project card appears in the *Ordered* column.

---

## 16. Project details page

**Type:** Story · **Phase 3 — not yet specified in detail** · **Blocked by:** 15 · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §7 step 17.
> Follow `CLAUDE.md`.
>
> The project's products and their frozen revisions, the BOM per product,
> progress per column from the quantity buckets, and history from `audit_logs`.
> Register the `/projects-preparation/projects/:id` route from §6.1 with this
> story, not before.
>
> Refine the scope with the product owner before starting — the plan designs
> for this page but does not specify it.

---

## 17. Orders page and goods receipt

**Type:** Story · **Phase 3 — not yet specified in detail** · **Blocked by:** 15 · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §7 step 18,
> §3.3 and §3.6. Follow `CLAUDE.md`.
>
> The orders list, and receiving against `order_lines`: write an ordinary
> `stock_entries` row of `type = 'received'` through the existing machinery so
> FIFO, weighted average price and currency provenance keep working, and bump
> `order_lines.received_qty` and `project_parts.received_qty` in the same
> transaction. Receiving makes the quantity pickable without rewriting any
> other column. Partial receipts must work.
>
> Turn the disabled Orders menu entry from story 2 into a real route.
>
> Refine the scope with the product owner before starting.

---

## 18. Preparation page

**Type:** Story · **Phase 3 — not yet specified in detail** · **Blocked by:** 17 · **Model:** Opus 5

> Repo: Levtech (PRODTRACK). Read `projects-preparation-plan.md` §7 step 19,
> §3.3 and §3.4. Follow `CLAUDE.md`.
>
> Pick lists per project, grouped per sub-product — this is what
> `project_part_usages.sub_product_revision_id` was written for, so read those
> rows uncollapsed rather than re-deriving anything from revisions. Picking
> writes a `removed` `stock_entries` row and bumps `prepared_qty`; a pick that
> would drive stock negative is refused (§4.2). When every line's buckets
> settle, `projects.status` becomes `completed`.
>
> Turn the disabled Preparation menu entry from story 2 into a real route.
>
> Refine the scope with the product owner before starting.

---

## Decision timeline

| Decision | Latest story it can be answered on | Cost of answering late |
|---|---|---|
| §8.1 *Prepared* column semantics | **5** | None — derived in the API, changeable any time. Decide while looking at real cards. |
| §8.4 stopping a project with open orders | **7** (shape), **15** (behaviour) | Reshaping the stop endpoint after it exists. |
| ~~§8.5 permissions~~ | **settled** | All logged-in users; `POST /api/companies` relaxes in story 11. |

---

## Which Claude model per story

Model lineup as of September 2026: **Fable 5.1** ($10/$50 per MTok, deepest
reasoning), **Opus 5** ($5/$25, complex agentic coding), **Sonnet 5** ($2/$10,
best speed/intelligence balance), **Haiku 4.5** ($1/$5, fastest).

**The rule that decides it here:** how a mistake fails. A wrong BOM aggregation,
a missing transaction boundary or a mis-summed quantity bucket fails *silently*
— the numbers look plausible and someone buys the wrong parts in three weeks.
A component that does not render fails *loudly*, in front of you, in seconds.
Spend on the silent ones. Also, the plan is unusually specific, so mid-tier
models go further on these stories than they would on a vague ticket.

| # | Story | Model | Why |
|---|---|---|---|
| 0 | Spike: validate the freeze query | **Opus 5** | Judgement, not typing — deciding whether the numbers are *right* is the whole task. |
| 1 | Migration + error contract | **Sonnet 5** | §3 gives the DDL almost verbatim. Transcription with care. |
| 2 | Menu group and routing | **Sonnet 5** | Contained UI change against a clear spec. |
| 3 | Stock availability service | **Sonnet 5** | Both queries are written out in §4.2. |
| 4 | Projects CRUD API | **Sonnet 5** | Standard CRUD with Zod; the board payload is specified. |
| 5 | Projects board UI | **Opus 5** | Seven components, real reuse judgement (`useConfirmDelete`, the product picker), and the plan describes behaviour rather than markup. |
| 6 | BOM computation + parts endpoint | **Opus 5** | The correctness-critical heart of the epic. Silent-failure territory. |
| 7 | Start and stop | **Opus 5** | Transaction boundaries, advisory locking, seeding rules. Concurrency bugs do not announce themselves. |
| 8 | Edit quantities + recalculate | **Sonnet 5** | Small surface, clamps fully specified. |
| 9 | Project parts table | **Sonnet 5** | Large but conventional; `useScopedCache` and `useTableSort` do the thinking. |
| 10 | Extract the PDF helper | **Sonnet 5** | Mechanical move. Verification is manual either way. |
| 11 | Offer processing API | **Opus 5** | Money, currency conversion with frozen rates, two `DISTINCT ON` queries, transactional upsert. |
| 12 | Offer processing grid | **Opus 5** | The hardest UI in the epic: dynamic columns, sticky layout, keyboard model, sorting with nulls, per-company footer. |
| 13 | Excel paste | **Sonnet 5** | Contained and precisely specified, including the edge cases. |
| 14 | Offer PDF export | **Sonnet 5** | Follows an existing, working export. |
| 15 | Order parts | **Opus 5** | Multi-order transaction, additive quantity bumps, the §8.4 stop behaviour. |
| 16–18 | Phase 3 pages | **Opus 5** | Deliberately under-specified — these stories include design, not just build. |

**Where Fable 5.1 earns its price.** Not by default. Two cases: Opus 5 gets
story 6, 7 or 12 visibly wrong twice, or you want one adversarial review pass
over the finished epic — "find the case where these quantity buckets disagree"
is exactly the kind of question deep reasoning pays for. Running the whole epic
on Fable would roughly double the bill for work the plan has already de-risked.

**Where Haiku 4.5 fits.** No whole story, but plenty of sub-tasks inside one:
adding the sixteen error codes with their English and Hungarian strings,
renaming across call sites, writing the i18n keys for a finished component.
Switch down for those rather than starting a story on it.

Rough split: 6 stories on Opus, 9 on Sonnet — the expensive model on the third
of the work where being wrong is expensive.
