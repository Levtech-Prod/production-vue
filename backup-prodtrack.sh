#!/usr/bin/env bash
#
# backup-prodtrack.sh — daily backup of the PRODTRACK database and uploaded
# files. Unlike deploy-ssh.sh, this one runs ON THE NAS, from DSM Task
# Scheduler. See BACKUP.md for installation and for how to restore.
#
# It writes a compressed pg_dump plus a hard-linked snapshot of
# backend/uploads into BACKUP_ROOT, verifies the dump is readable, and prunes
# everything but the newest RETENTION days.
#
# Usage:
#   ./backup-prodtrack.sh
#
# Any setting below can be overridden by an environment variable, e.g.:
#   RETENTION=60 ./backup-prodtrack.sh

set -euo pipefail

# --- Settings --------------------------------------------------------------
BACKUP_ROOT="${BACKUP_ROOT:-/volume1/backups/prodtrack}"
PROJECT_PATH="${PROJECT_PATH:-/volume1/docker/prodtrack}"
UPLOADS_SRC="${UPLOADS_SRC:-${PROJECT_PATH}/backend/uploads}"
PROJECT_NAME="${PROJECT_NAME:-levtech-production}"
DB_CONTAINER="${DB_CONTAINER:-${PROJECT_NAME}-db-1}"
DB_USER="${DB_USER:-levtech}"
DB_NAME="${DB_NAME:-levtechproduction}"
DOCKER="${DOCKER:-/usr/local/bin/docker}"   # Task Scheduler's PATH doesn't include it
RSYNC="${RSYNC:-/usr/bin/rsync}"
RETENTION="${RETENTION:-30}"                # daily backups to keep
MIN_FREE_GB="${MIN_FREE_GB:-5}"             # refuse to start below this
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-10240}"   # a dump smaller than this is a failed dump

DATE="$(date +%F)"
DB_DIR="${BACKUP_ROOT}/db"
UPLOADS_DIR="${BACKUP_ROOT}/uploads"
LOG_FILE="${BACKUP_ROOT}/logs/backup.log"

mkdir -p "$DB_DIR" "$UPLOADS_DIR" "$(dirname "$LOG_FILE")"

# Nothing here is urgent, and the NAS has 2 GB of RAM and four slow cores.
# Yielding CPU and disk means a backup that overruns into the morning still
# can't make the app feel slow.
command -v renice >/dev/null 2>&1 && renice -n 19 -p $$ >/dev/null 2>&1 || true
command -v ionice >/dev/null 2>&1 && ionice -c 3 -p $$ >/dev/null 2>&1 || true

log()  { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }
fail() { log "ERROR: $*"; exit 1; }

log "=== Backup start (retention: ${RETENTION} days) ==="

# --- Preflight -------------------------------------------------------------
[[ -x "$DOCKER" ]] || fail "docker not found at ${DOCKER}"
[[ -x "$RSYNC"  ]] || fail "rsync not found at ${RSYNC}"
[[ -d "$UPLOADS_SRC" ]] || fail "uploads folder not found: ${UPLOADS_SRC}"

[[ "$($DOCKER inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" == "true" ]] \
  || fail "container ${DB_CONTAINER} is not running — nothing to dump"

FREE_GB=$(( $(df -Pk "$BACKUP_ROOT" | awk 'END {print $4}') / 1024 / 1024 ))
(( FREE_GB >= MIN_FREE_GB )) \
  || fail "only ${FREE_GB} GB free on the backup volume (need ${MIN_FREE_GB} GB)"

# --- 1. Database -----------------------------------------------------------
# The database is dumped BEFORE the uploads snapshot, never after. A file
# uploaded between the two steps then lands in the snapshot without a row
# pointing at it — an orphan, which is harmless. The other order would produce
# a row pointing at a file the snapshot doesn't contain, which is a broken
# restore.
DUMP_OUT="${DB_DIR}/${DB_NAME}-${DATE}.dump"
DUMP_TMP="${DUMP_OUT}.tmp"
trap 'rm -f "$DUMP_TMP"' EXIT

log "Dumping ${DB_NAME} from ${DB_CONTAINER}..."
"$DOCKER" exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -Z 6 > "$DUMP_TMP"

DUMP_BYTES=$(wc -c < "$DUMP_TMP")
(( DUMP_BYTES >= MIN_DUMP_BYTES )) || fail "dump is only ${DUMP_BYTES} bytes — treating as failed"

# Reading the archive's table of contents back proves it is a complete,
# uncorrupted dump rather than a truncated one that only looks plausible.
"$DOCKER" exec -i "$DB_CONTAINER" pg_restore --list < "$DUMP_TMP" > /dev/null \
  || fail "dump failed verification (pg_restore --list could not read it)"

mv "$DUMP_TMP" "$DUMP_OUT"
trap - EXIT
ln -sfn "$(basename "$DUMP_OUT")" "${DB_DIR}/latest.dump"
log "Database dump OK: $(basename "$DUMP_OUT") ($(du -h "$DUMP_OUT" | cut -f1))"

# --- 2. Uploaded files -----------------------------------------------------
# Each snapshot is a full, browsable copy, but unchanged files are hard-linked
# to the previous day's, so 30 days cost roughly one copy of the tree plus the
# churn.
SNAP="${UPLOADS_DIR}/${DATE}"
SNAP_TMP="${SNAP}.tmp"
PREV="$(find "$UPLOADS_DIR" -maxdepth 1 -type d -name '????-??-??' | sort | tail -1)"

LINK_DEST=()
if [[ -n "$PREV" ]]; then LINK_DEST=(--link-dest="$PREV"); fi

rm -rf "$SNAP_TMP"
log "Snapshotting uploads${PREV:+ (linking unchanged files to $(basename "$PREV"))}..."
# --stats reports the day's churn for free. Measuring the snapshot with `du`
# instead would mean walking the whole tree a second time.
RSYNC_OUT="$("$RSYNC" -a --delete --stats "${LINK_DEST[@]}" "${UPLOADS_SRC}/" "${SNAP_TMP}/")" \
  || fail "rsync of uploads failed"
CHURN="$(printf '%s\n' "$RSYNC_OUT" | awk -F': *' '
  /Number of .*files transferred/ {files=$2}
  /Total transferred file size/   {bytes=$2}
  END {printf "%s files, %s copied", (files=="" ? "?" : files), (bytes=="" ? "?" : bytes)}')"

# Removing the old directory entries doesn't free the files themselves — the
# new snapshot already holds hard links to the same inodes.
rm -rf "$SNAP"
mv "$SNAP_TMP" "$SNAP"
log "Uploads snapshot OK: ${DATE} (${CHURN}, rest hard-linked)"

# --- 3. Prune --------------------------------------------------------------
# Pruning keeps the newest RETENTION entries rather than deleting by age: if
# the scheduled task ever stops running, an age-based rule would quietly
# delete its way down to no backups at all, while this one keeps the last good
# set forever.
prune() {
  local dir="$1" type="$2" pattern="$3" label="$4"
  local list count excess
  list="$(find "$dir" -maxdepth 1 -type "$type" -name "$pattern" | sort)"
  count="$(printf '%s' "$list" | grep -c . || true)"
  excess=$(( count - RETENTION ))
  (( excess > 0 )) || return 0
  printf '%s\n' "$list" | head -n "$excess" | while read -r victim; do
    log "Pruning old ${label}: $(basename "$victim")"
    rm -rf "$victim"
  done
}

prune "$DB_DIR"      f "*-????-??-??.dump" "dump"
prune "$UPLOADS_DIR" d "????-??-??"        "uploads snapshot"

DB_COUNT="$(find "$DB_DIR" -maxdepth 1 -type f -name '*.dump' | wc -l)"
SNAP_COUNT="$(find "$UPLOADS_DIR" -maxdepth 1 -type d -name '????-??-??' | wc -l)"
# Free space comes from df, not `du` on the backup root: du would stat every
# file in all 30 snapshots every night for a number nobody acts on, while df
# answers the question that actually matters in constant time.
FREE_AFTER="$(df -Ph "$BACKUP_ROOT" | awk 'END {print $4}')"
log "=== Backup done — ${DB_COUNT} dumps, ${SNAP_COUNT} uploads snapshots, ${FREE_AFTER} free ==="
