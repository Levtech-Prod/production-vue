#!/usr/bin/env bash
#
# deploy-ssh.sh — build the PRODTRACK images on your Mac and push them to the
# Synology over SSH: no File Station uploads, no Container Manager clicking.
#
# It builds both images, ships the tar to the NAS, loads it into Docker,
# recreates the containers via `docker compose up -d`, applies any migration
# files you pass as arguments, and prints container status.
#
# Prereqs (one time):
#   - SSH enabled on the NAS (Control Panel > Terminal & SNMP > Enable SSH).
#   - Your NAS user is in the "administrators" group (can run `sudo docker`).
#   - The project already deployed once so /volume1/docker/prodtrack exists
#     with docker-compose.yml + .env on the NAS (see DEPLOY.md).
#
# Usage:
#   ./deploy-ssh.sh                                   # build + deploy, no migrations
#   ./deploy-ssh.sh 007-add-parameter-show-as-column.sql   # + apply that migration
#   ./deploy-ssh.sh 007-....sql 008-....sql                # + apply several, in order
#
# Configure the NAS connection below, or override via env vars, e.g.:
#   NAS_HOST=192.168.1.50 NAS_USER=kincso ./deploy-ssh.sh 007-....sql
#
set -euo pipefail
cd "$(dirname "$0")"

# --- NAS connection (edit these, or pass as env vars) ----------------------
NAS_HOST="${NAS_HOST:-192.168.10.250}"        # NAS LAN IP or hostname
NAS_USER="${NAS_USER:-Kincso}"                # DSM user in administrators group
NAS_PORT="${NAS_PORT:-5022}"                    # SSH port
NAS_PATH="${NAS_PATH:-/volume1/docker/prodtrack}"

# --- Build settings --------------------------------------------------------
BACKEND_IMAGE="prodtrack-backend:latest"
FRONTEND_IMAGE="prodtrack-frontend:latest"
TAR="prodtrack-images.tar"
PLATFORM="linux/amd64"
DB_CONTAINER="prodtrack-db-1"
DB_USER="levtech"
DB_NAME="levtechproduction"

MIGRATIONS=("$@")   # migration filenames (in backend/database/migrations/) to apply

SSH="ssh -p ${NAS_PORT} ${NAS_USER}@${NAS_HOST}"
SSH_TTY="ssh -t -p ${NAS_PORT} ${NAS_USER}@${NAS_HOST}"   # -t so sudo can prompt
SCP="scp -P ${NAS_PORT}"

# --- Preflight -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not found. Start Docker Desktop first."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon not running. Open Docker Desktop and wait for the whale icon."; exit 1; }
docker buildx version >/dev/null 2>&1 || { echo "ERROR: docker buildx not available. Update Docker Desktop."; exit 1; }

for m in "${MIGRATIONS[@]}"; do
  [[ -f "backend/database/migrations/$m" ]] || { echo "ERROR: migration not found: backend/database/migrations/$m"; exit 1; }
done

# --- Git state -------------------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "WARNING: you are on '$BRANCH', not 'main'."
  read -rp "Continue building from '$BRANCH'? [y/N] " ans
  [[ "${ans:-N}" =~ ^[Yy]$ ]] || exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "WARNING: working tree has uncommitted changes — they WILL be baked into the image."
  git status --short
  read -rp "Continue anyway? [y/N] " ans
  [[ "${ans:-N}" =~ ^[Yy]$ ]] || exit 1
fi
echo "==> Building from commit: $(git log -1 --oneline)"

# --- Connectivity check ----------------------------------------------------
echo "==> Checking SSH to ${NAS_USER}@${NAS_HOST}:${NAS_PORT}..."
$SSH "test -f ${NAS_PATH}/docker-compose.yml" \
  || { echo "ERROR: cannot reach NAS or ${NAS_PATH}/docker-compose.yml missing. Check NAS_* settings and that the first deploy was done."; exit 1; }

# --- Build -----------------------------------------------------------------
echo "==> Building backend image ($PLATFORM)..."
docker buildx build --platform "$PLATFORM" -t "$BACKEND_IMAGE" --load ./backend

echo "==> Building frontend image ($PLATFORM)..."
docker buildx build --platform "$PLATFORM" -t "$FRONTEND_IMAGE" --load \
  -f frontend/Dockerfile --build-arg VITE_API_URL=/api .

# --- Export ----------------------------------------------------------------
echo "==> Exporting both images to $TAR..."
docker save "$BACKEND_IMAGE" "$FRONTEND_IMAGE" -o "$TAR"
echo "==> $(du -h "$TAR" | cut -f1) built."

# --- Ship to NAS -----------------------------------------------------------
echo "==> Copying $TAR to NAS..."
$SCP "$TAR" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/"

# Copy any migration files we're about to apply, so they exist on the NAS.
for m in "${MIGRATIONS[@]}"; do
  echo "==> Copying migration $m to NAS..."
  $SCP "backend/database/migrations/$m" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/backend/database/migrations/"
done

# --- Load + restart on the NAS --------------------------------------------
echo "==> Loading images and recreating containers on the NAS (sudo may prompt)..."
$SSH_TTY "cd ${NAS_PATH} && sudo docker load -i ${TAR} && sudo docker compose up -d"

# --- Apply migrations ------------------------------------------------------
for m in "${MIGRATIONS[@]}"; do
  echo "==> Applying migration $m..."
  $SSH_TTY "sudo docker exec -i ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -f /docker-entrypoint-initdb.d/source/migrations/${m}"
done

# --- Verify ----------------------------------------------------------------
echo "==> Container status:"
$SSH_TTY "cd ${NAS_PATH} && sudo docker compose ps"

echo
echo "==> Done. Open http://${NAS_HOST}:8080 to verify the app."
