# Deploying PRODTRACK to a Synology DS718+ (DSM 7.2.2)

Target setup: Docker containers managed by Synology's **Container Manager**, running on the LAN only (no external/HTTPS access). Three containers: `db` (PostgreSQL), `backend` (Node/Express API), `frontend` (Nginx serving the built Vue app, proxying `/api` and `/uploads` to the backend). Database data lives in a persistent Docker volume (`pgdata`); uploaded files are bind-mounted from `backend/uploads` in the project folder — both survive container rebuilds and are visible/browsable directly in File Station.

The DS718+ (Intel Celeron J3455, x86_64) fully supports Container Manager on DSM 7.2, so no workarounds are needed for CPU architecture.

## 1. Check / install Container Manager

1. Open DSM in a browser, go to **Package Center**.
2. Search for **Container Manager**.
   - If the button says **Open**, it's already installed — skip to step 2.
   - If it says **Install**, click it and wait for it to finish.

## 2. Check / enable SSH (optional, but recommended)

SSH lets you run `docker compose` from a terminal instead of only the GUI. Not required — see the GUI-only path in step 3 — but faster if you're comfortable with a terminal.

1. **Control Panel > Terminal & SNMP**.
2. Check **Enable SSH service**, note the port (default `22`), click **Apply**.
3. From your Mac: `ssh <your-dsm-username>@<NAS-LAN-IP> -p 22`.

## 3. Get the project onto the NAS

**Option A — SSH (faster, project already has a git remote):**

```bash
ssh <user>@<NAS-IP>
sudo mkdir -p /volume1/docker/prodtrack
sudo chown <user> /volume1/docker/prodtrack
cd /volume1/docker
git clone https://github.com/Levtech-Prod/production-vue.git prodtrack
```

**Option B — GUI only, no SSH:**

1. On your Mac, zip the project folder (exclude `node_modules` and `.env` files to keep the upload small — they aren't needed, Docker installs its own dependencies).
2. In DSM, open **File Station**, create a shared folder path `docker/prodtrack` if it doesn't exist.
3. Upload the zip into that folder, right-click it, choose **Extract Here**.

## 4. Create the environment file

The compose file reads secrets from a `.env` file that is **not** committed to git.

1. In the project folder (`/volume1/docker/prodtrack`), copy `.env.example` to `.env`.
2. Edit `.env` and set:
   - `POSTGRES_PASSWORD` — a strong password.
   - `JWT_SECRET` — a long random string (e.g. `openssl rand -hex 32`).
   - `HOST_PORT` — the LAN port the app will be reachable on (default `8080`; change if that port is already used by something else on the NAS).

Via SSH:
```bash
cd /volume1/docker/prodtrack
cp .env.example .env
vi .env   # or: nano .env
```

Via GUI: open `.env.example` in File Station's text editor, edit values, save as `.env` in the same folder.

## 5. Build the images on your Mac, then import them (required for a fixed 2 GB DS718+)

The stock DS718+'s 2 GB RAM can't reliably run `npm ci`/`vue-tsc`/`vite build`/`tsc` — the kernel OOM-kills the build partway through (that's the "Exit handler never called!" error). Since this NAS's RAM can't be upgraded, the images have to be **built elsewhere and only run on the NAS**. `docker-compose.yml` is already set up for this: `backend` and `frontend` reference `image: prodtrack-backend:latest` / `image: prodtrack-frontend:latest` with no `build:` step, so once those images exist on the NAS, Container Manager only ever starts containers — it never compiles anything.

Running the finished containers (Postgres + compiled Node backend + static files behind Nginx) takes well under 1 GB combined, so the NAS handles the *running* app comfortably. It's only compiling that's off the table.

### 5a. Install Docker Desktop on your Mac

1. Download it from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) and install normally.
2. Launch Docker Desktop once and let it finish starting (whale icon steady in the menu bar).

### 5b. Build both images (targeting the NAS's CPU architecture)

The DS718+ is x86_64/amd64, so build explicitly for that platform even if your Mac is Apple Silicon — Docker Desktop's buildx handles the cross-compile automatically.

```bash
cd /path/to/Levtech
docker buildx build --platform linux/amd64 -t prodtrack-backend:latest --load ./backend
docker buildx build --platform linux/amd64 -t prodtrack-frontend:latest --load -f frontend/Dockerfile --build-arg VITE_API_URL=/api .
```

(`--load` puts the finished images into your local Docker Desktop so the next step can export them. The frontend build uses the repo root as context — same reason as before: it needs `backend/src/schemas`.)

### 5c. Export both images to one file

```bash
docker save prodtrack-backend:latest prodtrack-frontend:latest -o prodtrack-images.tar
```

This produces a single `prodtrack-images.tar` (likely a few hundred MB).

### 5d. Get the tar onto the NAS and import it — no registry account needed

1. In DSM, open **File Station**, upload `prodtrack-images.tar` into `docker/prodtrack` (same folder as the project).
2. Open **Container Manager > Image**.
3. Click **Add > Add From File**, browse to the uploaded `prodtrack-images.tar`, and import it.
4. Confirm both `prodtrack-backend:latest` and `prodtrack-frontend:latest` now appear in the Image list.

### 5e. Create the project

1. **Container Manager > Project > Create**.
2. Project name: `prodtrack`.
3. Path: select `docker/prodtrack` (contains `docker-compose.yml` and `.env`).
4. Source: **Use existing docker-compose.yml**.
5. Click **Next**, review, **Done**.

Because the compose file has no `build:` steps, this only pulls `postgres:16-alpine` and `nginx:alpine` (small, prebuilt, low memory) and starts all three containers using the images you already imported — nothing gets compiled on the NAS. On the first successful start of the `db` container, `backend/database/schema.sql` and any files in `backend/database/migrations/` are applied automatically to create the tables.

## 6. Verify

1. **Container Manager > Container** — `prodtrack-db-1`, `prodtrack-backend-1`, `prodtrack-frontend-1` should all show status **Running**.
2. From a machine on the same LAN, open `http://<NAS-LAN-IP>:8080` (or whatever `HOST_PORT` you set).
3. Go to `/signup`, create the first user with **Admin user** checked (per the existing README testing flow).

If a container shows an error status, check its logs in Container Manager (click the container > **Details** > **Log**), or via SSH: `sudo docker compose logs -f backend`.

## 7. Auto-start on reboot

`docker-compose.yml` sets `restart: unless-stopped` on all three services, so they come back up automatically if the NAS reboots. In **Container Manager > Project**, make sure **prodtrack** has auto-start enabled (it is by default when created via the GUI).

## 8. Backups

- **Database**: schedule a `pg_dump` via DSM **Task Scheduler** (Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script):
  ```bash
  docker exec prodtrack-db-1 pg_dump -U levtech levtechproduction | gzip > /volume1/docker/prodtrack-backups/db-$(date +%F).sql.gz
  ```
- **Uploaded files** (`backend/uploads`, bind-mounted from the project folder — used for part-category/part/product/sub-product images and documents): it's a regular folder under `/volume1/docker/prodtrack/backend/uploads`, so Hyper Backup (or any File Station-based backup) covers it directly with no `docker run` step needed. For a manual snapshot:
  ```bash
  tar czf /volume1/docker/prodtrack-backups/uploads-$(date +%F).tar.gz -C /volume1/docker/prodtrack/backend uploads
  ```
- Point **Hyper Backup** at `/volume1/docker/prodtrack-backups` to get these off-box.

## 9. Firewall (only relevant if DSM's firewall is enabled)

**Control Panel > Security > Firewall** — if a firewall policy is active, add a rule allowing the `HOST_PORT` (e.g. `8080`) from your LAN subnet.

## Notes on DS718+ hardware limits

The stock DS718+ has 2 GB RAM. That's enough to *run* three small containers (Postgres + compiled Node + Nginx serving static files) comfortably, but not enough to reliably *compile* them (`npm ci` + `vue-tsc` + `vite build` + `tsc` are memory-hungry and get OOM-killed). That's why step 5 builds images on a separate machine and only imports the finished result — this isn't a workaround for a one-off failure, it's the standing approach for this hardware, since the RAM ceiling here is fixed.

If you ever see `error Exit handler never called!` again, it means something tried to run `npm ci` directly on the NAS — double check `docker-compose.yml` still has `image:` (not `build:`) for `backend` and `frontend`.

## Updating the app later

Rebuild off the NAS and re-import, the same way as the initial deploy:

```bash
cd /path/to/Levtech
git pull
docker buildx build --platform linux/amd64 -t prodtrack-backend:latest --load ./backend
docker buildx build --platform linux/amd64 -t prodtrack-frontend:latest --load -f frontend/Dockerfile --build-arg VITE_API_URL=/api .
docker save prodtrack-backend:latest prodtrack-frontend:latest -o prodtrack-images.tar
```

Upload the new `prodtrack-images.tar` via File Station and import it again (**Container Manager > Image > Add > Add From File**) — importing an image with a tag that already exists overwrites it. Then in **Container Manager > Project > prodtrack**, use **Action > Restart** (or **Stop** then **Start**) to pick up the new images; no rebuild happens on the NAS.

New migration files placed in `backend/database/migrations/` after the database already exists won't run automatically (the init script only runs once, against an empty database). Apply them manually:

```bash
docker exec -i prodtrack-db-1 psql -U levtech -d levtechproduction -f /docker-entrypoint-initdb.d/source/migrations/<new-file>.sql
```

## 10. One-off uploads restructure (run once, after deploying that release)

The release that introduces `uploads/products/{id}-{Name}-{SKU}/` needs a one-off
migration of the existing files. Full background: `uploads-restructure-plan.md`.

Container names below use the compose project name `deploy-ssh.sh` sets
(`levtech-production`). Confirm with `sudo docker ps --format '{{.Names}}'` —
older text in this file used a `prodtrack-` prefix, which no longer matches.

**Step 0, before deploying.** Migration 014 fails loudly if any sub-product has
no parent, which would abort the deploy script partway. Check first:

```bash
sudo docker exec levtech-production-db-1 psql -U levtech -d levtechproduction \
  -c "SELECT id, name, sku FROM sub_products WHERE product_id IS NULL;"
```

Assign or delete anything it returns before going further.

**Step 1, back up.** The migration moves files; there is no undo once it
commits. Do this *before* running the deploy script, since that script applies
014 for you.

```bash
sudo docker exec levtech-production-db-1 pg_dump -U levtech levtechproduction \
  | gzip > /volume1/docker/prodtrack-backups/db-before-uploads-$(date +%F).sql.gz
cp -a /volume1/docker/prodtrack/backend/uploads \
      /volume1/docker/prodtrack/backend/uploads.bak
```

**Step 2, deploy + apply 014.** From your Mac, with a clean working tree:

```bash
./deploy-ssh.sh 014-require-sub-product-parent.sql
```

Deploying before migrating is safe and deliberate: the new code writes to the
new tree while existing rows still point at the old paths, and nothing reads a
folder name, so the two coexist.

**Step 3, migrate the files.** On the NAS:

```bash
# Inspect the plan. Changes nothing.
sudo docker exec levtech-production-backend-1 node dist/scripts/migrate-uploads.js --dry-run

# Apply, after reading the report. --yes because docker exec is not interactive.
sudo docker exec levtech-production-backend-1 node dist/scripts/migrate-uploads.js --yes
```

The scripts are compiled into the image (`dist/scripts/`) precisely because the
production stage installs with `--omit=dev` and so has no `tsx`. They read
`DATABASE_URL` from the container environment, so no `.env` handling is needed —
run them with plain `node`, not the `npm run` aliases, which use `dotenv-cli`.

Read the dry-run summary before step 4:

- **Unmappable** — a folder or image path whose owner cannot be derived. The run
  **aborts** rather than guessing. Fix those by hand and re-run, or pass
  `--skip-unmappable` to leave them in place.
- **Source file missing** — a `stored_files` row whose file is already gone. The
  path is rewritten anyway so the database stays consistent.
- **Orphan files** — on disk with no row pointing at them. Left alone, never
  deleted.

The migration is idempotent, so a re-run after a partial failure resumes rather
than double-moving. Verify afterwards with the queries in
`uploads-restructure-plan.md` §7, then delete `uploads.bak`.

Later, if folder names drift because products were renamed:

```bash
sudo docker exec levtech-production-backend-1 node dist/scripts/resync-upload-folder-names.js --dry-run
```
