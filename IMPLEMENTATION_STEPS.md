# Implementation steps

## 1. Install dependencies

```bash
npm run install:all
```

## 2. Configure backend

```bash
cd backend
cp .env.example .env
```

Example PostgreSQL config:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/levtechproduction"
JWT_SECRET="change-this-secret"
PORT=4000
FRONTEND_URL="http://localhost:5173"
```

## 3. Create database tables

Make sure the `levtechproduction` database exists, then run:

```bash
npm run db:init
```

This runs `backend/database/schema.sql` and creates:

- `users`
- `part_categories`
- `part_category_parameters`
- `parts`
- `stock_parameters`

## 4. Start backend

```bash
npm run dev
```

## 5. Start frontend

```bash
cd ../frontend
cp .env.example .env
npm run dev
```

## 6. Test flow

1. Open `http://localhost:5173/signup`.
2. Create an admin user by checking `Admin user`.
3. Go to `Alkatrész kategóriák`.
4. Add a category, image URL, and parameters, for example `Resistor` with `Resistance`, `Tolerance`, `Power`.
5. Go to `Alkatrészek`.
6. Select the category and enter the dynamic parameter values.
7. Check the Users table.

## Current schema decisions

- `PartCategory.image` is stored as text, intended for an image URL/path.
- `Part.price_per_piece` replaces the previous price field.
- Prisma has been removed.
- Dynamic parameters are only for part categories at this stage.

## Future improvements

- Add file upload for category images instead of URL-only storage.
- Add edit/delete actions.
- Add stock quantity and stock movements.
- Add suppliers and purchase orders.
- Add admin invitation flow instead of public admin checkbox.
- Add refresh token / secure cookie auth.
