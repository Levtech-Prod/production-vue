# Deploying PRODTRACK to a Synology DS718+ (DSM 7.2.2)

Target setup: Docker containers managed by Synology's **Container Manager**, running on the LAN only (no external/HTTPS access). Three containers: `db` (PostgreSQL), `backend` (Node/Express API), `frontend` (Nginx serving the built Vue app, proxying `/api` and `/uploads` to the backend). Data lives in two persistent Docker volumes (`pgdata`, `uploads`) so it survives container rebuilds.

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

## 5. Build and start the containers

**Via Container Manager (GUI):**

1. Open **Container Manager > Project > Create**.
2. Project name: `prodtrack`.
3. Path: select `docker/prodtrack` (the folder from step 3, which contains `docker-compose.yml`).
4. Source: choose **Use existing docker-compose.yml** — Container Manager will detect the file already in that folder.
5. Click **Next**, review, then **Done/Build**.

**Via SSH instead:**

```bash
cd /volume1/docker/prodtrack
sudo docker compose up -d --build
```

The first build compiles the TypeScript backend, runs `vue-tsc`/`vite build` for the frontend, and downloads the `postgres:16-alpine` and `nginx:alpine` base images. On DS718+ hardware this typically takes 5–15 minutes — this is a one-time cost; later restarts are fast. On the first successful start of the `db` container, `backend/database/schema.sql` and any files in `backend/database/migrations/` are applied automatically to create the tables.

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
  docker exec prodtrack-db-1 pg_dump -U produser prodtrack | gzip > /volume1/docker/prodtrack-backups/db-$(date +%F).sql.gz
  ```
- **Uploaded files** (`uploads` volume, used for part-category images and documents): back up with
  ```bash
  docker run --rm -v prodtrack_uploads:/data -v /volume1/docker/prodtrack-backups:/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
  ```
- Point **Hyper Backup** at `/volume1/docker/prodtrack-backups` to get these off-box.

## 9. Firewall (only relevant if DSM's firewall is enabled)

**Control Panel > Security > Firewall** — if a firewall policy is active, add a rule allowing the `HOST_PORT` (e.g. `8080`) from your LAN subnet.

## Notes on DS718+ hardware limits

The stock DS718+ ships with 2 GB RAM (expandable to 6 GB). Building all three images the first time (`npm ci`, `vue-tsc`, `vite build`, `tsc`) is the most memory/CPU-intensive moment. If the build stalls or the container gets OOM-killed:

- Pause other running containers/services during the build, or
- Add RAM, or
- Build the images on your Mac instead (`docker buildx build --platform linux/amd64 ...`), push them to a registry (e.g. Docker Hub), and reference the pre-built image names in `docker-compose.yml` instead of `build:` — then the NAS only has to pull, not compile.

## Updating the app later

```bash
cd /volume1/docker/prodtrack
git pull
sudo docker compose up -d --build
```

New migration files placed in `backend/database/migrations/` after the database already exists won't run automatically (the init script only runs once, against an empty database). Apply them manually:

```bash
docker exec -i prodtrack-db-1 psql -U produser -d prodtrack -f /docker-entrypoint-initdb.d/source/migrations/<new-file>.sql
```
