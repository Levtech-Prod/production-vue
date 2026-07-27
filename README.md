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

## Deploy to the Synology NAS

The app runs on the NAS as three containers (`db`, `backend`, `frontend`) under the Container Manager project **`levtech-production`**. Because the NAS can't compile the images (2 GB RAM), they're built on a Mac and only *run* on the NAS. See `DEPLOY.md` for the full first-time setup.

### Ship an update (one command)

```bash
# on the Mac, on main, Docker Desktop running:
git checkout main && git pull
./deploy-ssh.sh 007-add-parameter-show-as-column.sql   # pass any NEW migration files
```

Prereqs: SSH enabled on the NAS, your DSM user in the administrators group, and the connection values set at the top of `deploy-ssh.sh` (`NAS_HOST`, `NAS_USER`, `NAS_PORT`). No arguments = deploy code only, no migrations.

Prefer the manual File Station route? Run `./deploy-build.sh` instead — it builds the tar and prints the Container Manager steps.

### What happens in the background

1. **Build** — `deploy-ssh.sh` builds `prodtrack-backend:latest` and `prodtrack-frontend:latest` for `linux/amd64` (the NAS's CPU) and exports both into a single `prodtrack-images.tar`.
2. **Ship** — the tar (and any migration files passed as arguments) are copied to `/volume1/docker/prodtrack` on the NAS over SSH.
3. **Load** — `docker load` imports the tar, overwriting the `:latest` tags; the old images stay running until the next step.
4. **Restart** — `docker compose -p levtech-production up -d` compares the compose file to what's running and recreates **only** the changed services (backend + frontend). The `db` container and its `pgdata` volume are left untouched, so no data is lost. The `-p` flag targets the existing project even though its folder is named `prodtrack`.
5. **Migrate** — each migration file passed as an argument is applied to `levtech-production-db-1` with `psql`. This is manual because the DB's auto-init script only runs once, against an empty database.
6. **Verify** — the script prints `compose ps`; then open `http://<NAS-IP>:8080` and confirm all three containers are Running.

## Notes

- Passwords are hashed with bcrypt.
- Auth uses JWT.
- Admin flag is stored as boolean `admin`.
- Part dynamic values are stored in `stock_parameters`.
- Dynamic parameters are implemented for part categories only.
