# PRODTRACK MVP

Vue 3 + TypeScript + Tailwind frontend and Node.js + Express backend using raw PostgreSQL queries for:

- Sign up / login with admin and client roles
- Users table
- Part categories with dynamic parameters and an image field
- Parts with category-based parameter values
- Part values stored in `stock_parameters`

Prisma is intentionally not used. The backend uses `pg` and SQL directly so later BOM, stock reservation, reporting, and revision queries can be written and optimized explicitly.

## Quick start

### 1. Backend

Create a PostgreSQL database, then configure the backend:

```bash
cd backend
cp .env.example .env
npm install
npm run db:init
npm run dev
```

Default backend URL: `http://localhost:4000`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Default frontend URL: `http://localhost:5173`

## Database

Main tables:

- `users`
- `part_categories`
- `part_category_parameters`
- `parts`
- `stock_parameters`

Important fields:

- `part_categories.image`
- `parts.price_per_piece`

## Notes

- Passwords are hashed with bcrypt.
- Auth uses JWT.
- Admin flag is stored as boolean `admin`.
- Part dynamic values are stored in `stock_parameters`.
- Dynamic parameters are implemented for part categories only.
