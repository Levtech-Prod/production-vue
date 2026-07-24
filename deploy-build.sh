#!/usr/bin/env bash
#
# deploy-build.sh — build the PRODTRACK images on your Mac and export them
# to a single tar for import into Synology Container Manager.
#
# Run this on the Mac (Docker Desktop must be running). It does NOT touch the
# NAS — after it finishes, follow the printed checklist in File Station /
# Container Manager. See DEPLOY.md for the full explanation.
#
set -euo pipefail

cd "$(dirname "$0")"

BACKEND_IMAGE="prodtrack-backend:latest"
FRONTEND_IMAGE="prodtrack-frontend:latest"
TAR="prodtrack-images.tar"
PLATFORM="linux/amd64"   # DS718+ is x86_64

# --- Preflight -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not found. Start Docker Desktop first."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon not running. Open Docker Desktop and wait for the whale icon."; exit 1; }
docker buildx version >/dev/null 2>&1 || { echo "ERROR: docker buildx not available. Update Docker Desktop."; exit 1; }

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

# --- Build -----------------------------------------------------------------
echo "==> Building backend image ($PLATFORM)..."
docker buildx build --platform "$PLATFORM" -t "$BACKEND_IMAGE" --load ./backend

echo "==> Building frontend image ($PLATFORM)..."
docker buildx build --platform "$PLATFORM" -t "$FRONTEND_IMAGE" --load \
  -f frontend/Dockerfile --build-arg VITE_API_URL=/api .

# --- Export ----------------------------------------------------------------
echo "==> Exporting both images to $TAR..."
docker save "$BACKEND_IMAGE" "$FRONTEND_IMAGE" -o "$TAR"
echo "==> Done. $(du -h "$TAR" | cut -f1) written to $(pwd)/$TAR"

# --- New migrations since the last deploy ----------------------------------
echo
echo "==> Migration files present (check which are NEW since the last deploy):"
ls -1 backend/database/migrations/ 2>/dev/null | sed 's/^/      /' || echo "      (none)"

# --- Next steps ------------------------------------------------------------
cat <<'EOF'

--------------------------------------------------------------------------
NEXT — do these in DSM on the NAS:

1. File Station  →  upload  prodtrack-images.tar  into  docker/prodtrack
   (overwrite the old one).
   If you added a NEW migration file, also upload it into
   docker/prodtrack/backend/database/migrations/  on the NAS.

2. Container Manager → Image → Add → Add From File → pick the tar → import.
   (Re-importing overwrites the :latest tags — that's expected.)

3. Container Manager → Project → prodtrack → Action → Stop, then Start
   (or Restart) to pick up the new images.

4. Apply any NEW migration manually (init script only runs on an empty DB):
   docker exec -i prodtrack-db-1 psql -U levtech -d levtechproduction \
     -f /docker-entrypoint-initdb.d/source/migrations/<new-file>.sql

5. Verify: open http://<NAS-LAN-IP>:8080 and confirm all three containers
   (prodtrack-db-1 / -backend-1 / -frontend-1) show Running.
--------------------------------------------------------------------------
EOF
