# Levtech — Project Rules

Stack: Vue 3 + TypeScript + Vite + Pinia + Tailwind (frontend), Express + TypeScript + PostgreSQL (backend).

These rules apply to all code written or edited in this project.

## Before writing something new

Search before you build. Most features here have a sibling that already solved
the same problem, and the cheapest bug to avoid is the one you copy.

- **Look first.** Before implementing anything — a component, a composable, a
  service helper, an endpoint shape — search for an existing version of it.
  Search by concept, not by name: "a modal that names a file before upload",
  "a cache keyed by the current selection", "pick a target, confirm, delete"
  may all exist under wording you wouldn't guess.
- **Where to look:** `frontend/src/components`, `frontend/src/composables`,
  `frontend/src/utils`, `backend/src/services`, and above all the existing
  feature most like the one you're adding — new panels almost always parallel
  an old one.
- **If something close exists, use it.** If it's close but not exact, prefer
  widening it — a prop, a parameter, a type argument — over copying it. Update
  every call site in the same change, so the two can't drift.
- **Write something new only when reuse would bend the existing code out of
  shape.** When you do, say in a comment what you looked at and why it didn't
  fit, so the next person doesn't redo the search.
- **Similar-looking is not duplicated.** Duplication is the same *decision*
  written twice. Two things with the same shape but different meaning — say two
  status colour maps that encode deliberately different palettes — should stay
  apart; merging them yields a helper with a discriminator parameter that is no
  simpler than the two it replaced. Ask whether a change to one should
  necessarily change the other. If yes, share it. If no, leave it.

## Code quality

- Keep code clean and optimized — remove dead code, unused imports/vars, and stray console logs before finishing a task.
- Avoid duplication: extract repeated logic into helper functions, composables (`frontend/src/composables`), shared variables, or sub-components rather than copy-pasting. This applies to code you are adding *now*, not only to duplication you find later — see "Before writing something new" above.
- Cache data where it meaningfully improves performance (e.g. expensive queries, repeated API calls, derived state) — but don't cache prematurely or where it risks stale data on writes.

## Comments

- Comment only what the code can't say itself: a non-obvious *why*, a trap, a decision someone would otherwise undo. Default to none.
- Keep them short — one line where possible, two or three at most. Prefer a clearer name or a small helper over a comment explaining unclear code.
- Don't restate the code, narrate steps, label obvious blocks, or leave TODOs and commented-out code.
- Worth a comment: why an approach was rejected, a subtle contract (`null` vs `undefined`, ordering, locking), a workaround with its reason, a non-obvious security or performance constraint.
- Public helpers and exported types get a one-line JSDoc when the name alone isn't enough; skip it when it is.
- When editing, delete comments the change made wrong or redundant — a stale comment is worse than none.

## Type safety

- No `any`. Use proper types/interfaces, or `unknown` with narrowing.
- Validate all external input (API request bodies, query params) with Zod at the boundary before it touches business logic.

## Backend (Express + PostgreSQL)

- All DB queries must be parameterized (no string-concatenated SQL).
- Schema/data changes go through `backend/database/migrations`, never manual edits to `schema.sql` alone.
- Routes return a consistent error shape; no silent `catch` blocks — log or rethrow.
- Secrets and config only via `.env`, never hardcoded. Update `.env.example` when adding a new var.

## Frontend (Vue)

- Keep single-file components focused; split into sub-components when a file grows too large or mixes unrelated concerns.
- Shared UI logic goes into composables, not duplicated across components.
- Use Pinia stores for cross-component state, not prop-drilling or global mutables.

## Structure

- Match existing folder conventions in `backend/src` and `frontend/src` — don't introduce a new pattern without a reason.

## Collaboration

- If a better approach exists besides what was asked, propose it in addition to doing the requested task — don't silently substitute it.
- If a request is ambiguous or missing details needed to do it correctly, ask before proceeding rather than guessing.

## Planning & implementation review

- In any planning or implementation session, review the result before finishing: confirm it is the best, most optimized solution — and that it is not overengineered. Prefer the simplest design that fully meets the requirement over one with unnecessary abstraction, tables, or machinery.
