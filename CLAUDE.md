# Levtech — Project Rules

Stack: Vue 3 + TypeScript + Vite + Pinia + Tailwind (frontend), Express + TypeScript + PostgreSQL (backend).

These rules apply to all code written or edited in this project.

## Code quality

- Keep code clean and optimized — remove dead code, unused imports/vars, and stray console logs before finishing a task.
- Avoid duplication: extract repeated logic into helper functions, composables (`frontend/src/composables`), shared variables, or sub-components rather than copy-pasting.
- Cache data where it meaningfully improves performance (e.g. expensive queries, repeated API calls, derived state) — but don't cache prematurely or where it risks stale data on writes.

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
