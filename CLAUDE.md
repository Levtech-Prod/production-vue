# Levtech — Project Rules

Stack: Vue 3 + TypeScript + Vite + Pinia + Tailwind (frontend), Express + TypeScript + PostgreSQL (backend).

These rules apply to all code written or edited in this project.

## Code quality

- Keep code clean and optimized — remove dead code, unused imports/vars, and stray console logs before finishing a task.
- Avoid duplication: extract repeated logic into helper functions, composables (`frontend/src/composables`), shared variables, or sub-components rather than copy-pasting.
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
