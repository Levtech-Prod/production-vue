# Backing up and restoring PRODTRACK

The NAS runs a daily job that dumps the PostgreSQL database and snapshots the
uploaded files into `/volume1/backups/prodtrack`, keeping the last 30 days.
The job is `backup-prodtrack.sh` in this repo; unlike `deploy-ssh.sh` it runs
**on the NAS**, from DSM Task Scheduler.

## What is and isn't covered

| | Covered | How |
|---|---|---|
| Database (`levtechproduction`) | yes | `pg_dump -Fc`, one file per day |
| Uploaded images & document revisions | yes | daily hard-linked snapshot of `backend/uploads` |
| `.env` (DB password, `JWT_SECRET`) | **no** | keep a copy in a password manager — see below |
| Docker images | no | rebuilt from git with `deploy-ssh.sh` |
| DSM / Container Manager config | no | Hyper Backup covers this separately |

`.env` is deliberately left out: the daily backup folder is the thing most
likely to be copied off-box or onto a laptop, and secrets shouldn't ride along
in plaintext. Losing `JWT_SECRET` only logs everyone out; losing
`POSTGRES_PASSWORD` costs you the live `pgdata` volume, so store both somewhere
safe now rather than after the fact.

## Layout on the NAS

```
/volume1/backups/prodtrack/
├── db/
│   ├── levtechproduction-2026-08-28.dump   # pg_dump custom format, gzip level 6
│   ├── ... (30 days)
│   └── latest.dump -> levtechproduction-2026-08-28.dump
├── uploads/
│   ├── 2026-08-28/                         # full browsable tree
│   └── ... (30 days)
└── logs/backup.log
```

Each uploads snapshot looks like a complete copy, but files unchanged since the
day before are hard links to the same blocks. Thirty days of snapshots cost
roughly one copy of `uploads` plus whatever actually changed.

## Why these choices

- **Custom-format dumps (`-Fc`), not plain `.sql.gz`.** `pg_restore` can then
  restore selectively — one table, schema only, or a listing of what's inside —
  and refuses to run a corrupt archive rather than replaying half of it.
- **The dump is verified before it counts.** The script reads the archive's
  table of contents back with `pg_restore --list`; a truncated dump that merely
  looks plausible fails the run instead of quietly replacing a good backup.
- **Database first, uploads second.** A file uploaded between the two steps
  ends up in the snapshot with no database row pointing at it — an orphan,
  which is harmless. The reverse order would leave a row pointing at a file
  the snapshot doesn't have, which is a broken restore.
- **Retention is by count, not by age.** `find -mtime +30 -delete` looks
  equivalent until the job stops running, at which point it deletes its way
  down to zero backups. Keeping the newest 30 entries fails safe.
- **Nothing is written until it is complete.** Dumps land on a `.tmp` name and
  are renamed only after verification; a failed run leaves yesterday's good
  backup untouched and exits non-zero so DSM can email you.
- **Nothing walks the backup tree.** The run reports free space with `df` and
  the day's churn from rsync's own `--stats`. A `du` over the backup root would
  stat every file in all 30 snapshots, every night, to print a number nobody
  acts on.
- **The job yields.** It reduces its own CPU and I/O priority on startup, so
  even a run that overruns into the morning can't make the app feel slow.

Both halves stream rather than accumulate, so peak memory is well under 100 MB:
`pg_dump` pipes table by table, and rsync's file list scales with file count
(~100 bytes each, with incremental recursion) rather than with data size. This
is why backups are fine on a NAS that can't compile the app — `vue-tsc` and
`vite` hold whole ASTs in memory at once, which is a different problem.

## One-time setup

### 1. Create the backup shared folder

**DSM > Control Panel > Shared Folder > Create**, name it `backups`. Leaving
it out of the Docker folder keeps backups clear of anything the deploy touches,
and gives Hyper Backup a single clean target later.

The script creates `prodtrack/` and its subfolders itself on first run.

While you're here, keep the indexer out of it: **Control Panel > Indexing
Service > Indexed Folder List** — make sure `backups` isn't listed, and exclude
it from antivirus scans if you run Synology's. Left alone, Universal Search
will walk 30 snapshots × every file and try to thumbnail every image in all of
them. That is by far the largest resource cost this setup can incur on a 2 GB
NAS, and it comes from DSM rather than from the backup itself.

### 2. Put the script on the NAS

From your Mac, in this repo:

```bash
scp -O -P 5022 backup-prodtrack.sh Kincso@192.168.10.250:/volume1/docker/prodtrack/
ssh -p 5022 Kincso@192.168.10.250 'chmod +x /volume1/docker/prodtrack/backup-prodtrack.sh'
```

(`-O` because Synology usually lacks the SFTP subsystem — same reason
`deploy-ssh.sh` uses it.)

`deploy-ssh.sh` ships images and migrations only — it does not sync this repo
to the NAS. So the copy on the NAS is a point-in-time copy: deploying a new
release neither installs this script nor updates it. Re-run the `scp` above
whenever `backup-prodtrack.sh` changes in git.

### 3. Create the scheduled task

**Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script**

| Field | Value |
|---|---|
| Task | `PRODTRACK daily backup` |
| User | `root` |
| Schedule | Daily, **03:00** |
| Run command | `bash /volume1/docker/prodtrack/backup-prodtrack.sh` |

`root` is required — it's what can talk to the Docker socket and write into
`/volume1/backups`. 03:00 is simply a quiet hour; the dump takes seconds on a
database this size.

On the **Task Settings** tab, tick **Send run details by email**, choose **only
when the script terminates abnormally**, and enter your address. This is the
part that makes the whole thing trustworthy — without it, a backup that stops
working stops silently. Email needs **Control Panel > Notification** configured
first.

### 4. Run it once by hand and check the result

Select the task, click **Run**, then:

```bash
ssh -p 5022 Kincso@192.168.10.250
sudo tail -20 /volume1/backups/prodtrack/logs/backup.log
sudo ls -lh /volume1/backups/prodtrack/db/
```

A good run ends with `=== Backup done — N dumps, N uploads snapshots, ... ===`.

### 5. Save the secrets

Copy the values from `/volume1/docker/prodtrack/.env` (`POSTGRES_PASSWORD`,
`JWT_SECRET`) into your password manager. Do this once now; update it if you
ever rotate them.

## Changing the retention

Retention lives in the script (`RETENTION="${RETENTION:-30}"`) and can also be
overridden per run. To keep 60 days, change the Task Scheduler command to:

```bash
RETENTION=60 bash /volume1/docker/prodtrack/backup-prodtrack.sh
```

Lowering it takes effect on the next run — the extra backups get pruned then.

## Restoring

**Become root first — every command in this section assumes it:**

```bash
ssh -p 5022 Kincso@192.168.10.250
sudo -i
```

This matters more than it looks. The backups are written by a root-only job, so
your own user can't read them. Prefixing a command with `sudo` is not enough:
in `sudo pg_restore … < backup.dump` the `<` redirect is performed by *your*
shell before sudo runs, so it fails with `Permission denied` while the `sudo`
part looks correct. Becoming root once avoids the trap everywhere.

### Restore the database

Stop the app first so nothing writes while the tables are being replaced.

```bash
cd /volume1/docker/prodtrack

/usr/local/bin/docker compose -p levtech-production stop backend frontend

/usr/local/bin/docker exec -i levtech-production-db-1 \
  pg_restore -U levtech -d levtechproduction \
             --clean --if-exists --no-owner --single-transaction \
  < /volume1/backups/prodtrack/db/levtechproduction-2026-08-28.dump

/usr/local/bin/docker compose -p levtech-production start backend frontend
```

`--single-transaction` means it either fully succeeds or leaves the database
exactly as it was — there is no half-restored state to clean up.

### Restore the uploaded files

```bash
rsync -a --delete \
  /volume1/backups/prodtrack/uploads/2026-08-28/ \
  /volume1/docker/prodtrack/backend/uploads/
```

`--delete` makes the folder match the snapshot exactly, which is what you want
when restoring alongside a database from the same day. Drop `--delete` if you
only want to bring back missing files and keep everything newer.

### Restore both to a consistent point

Use the **same date** for the dump and the snapshot, and do the database first:

```bash
/usr/local/bin/docker compose -p levtech-production stop backend frontend
# ...pg_restore from db/levtechproduction-<DATE>.dump...
rsync -a --delete /volume1/backups/prodtrack/uploads/<DATE>/ \
                  /volume1/docker/prodtrack/backend/uploads/
/usr/local/bin/docker compose -p levtech-production start backend frontend
```

Because the database is dumped before the snapshot each night, a same-date pair
can only ever contain extra files, never missing ones.

### Recover onto a replacement NAS

1. Follow `DEPLOY.md` steps 1–5 to get Container Manager, the project folder,
   `.env` (from your password manager), the images, and a running empty stack.
2. Restore the database as above — `--clean --if-exists` replaces the empty
   schema the init script created.
3. Restore the uploads snapshot as above.
4. Re-create this backup task (steps 1–4 of this document).

### Inspect a backup without restoring it

```bash
# what's inside
/usr/local/bin/docker exec -i levtech-production-db-1 pg_restore --list \
  < /volume1/backups/prodtrack/db/latest.dump | head -40

# one table only, into the live database
/usr/local/bin/docker exec -i levtech-production-db-1 \
  pg_restore -U levtech -d levtechproduction --data-only --table=parts --no-owner \
  < /volume1/backups/prodtrack/db/latest.dump
```

## Test the restore, quarterly

A backup nobody has restored is a hypothesis. Restoring into a throwaway
database proves it without touching production. As root (`sudo -i`):

```bash
D=/usr/local/bin/docker

$D exec levtech-production-db-1 createdb -U levtech restoretest
$D exec -i levtech-production-db-1 \
  pg_restore -U levtech -d restoretest --no-owner < /volume1/backups/prodtrack/db/latest.dump
$D exec levtech-production-db-1 \
  psql -U levtech -d restoretest -c '\dt' -c 'SELECT count(*) FROM users;'
$D exec levtech-production-db-1 dropdb -U levtech restoretest
```

If the table list and row counts look like production, the backup is real. An
empty `\dt` means the `pg_restore` line didn't actually run — check it for a
`Permission denied` on the dump, which is the redirect-runs-as-you trap above.

## Getting the backups off the NAS (set up when you have a destination)

Thirty days of backups on the same NAS as the live database protects you from
the mistakes — a bad migration, a deleted product, a wrong bulk edit. It does
not protect you from the NAS itself: one failed volume, one theft, one
ransomware run through an SMB share takes the app and all 30 days with it. The
local job is worth having on its own, but it is only half the story.

When an external USB drive or a cloud account (Synology C2, Backblaze B2,
Dropbox, or a second NAS) is available:

1. **Package Center** — install **Hyper Backup**.
2. **Hyper Backup > + > Data backup task**, pick the destination.
3. Select these folders:
   - `/volume1/backups/prodtrack/db` — the daily dumps.
   - `/volume1/docker/prodtrack/backend/uploads` — the **live** uploads folder,
     not the snapshot tree. Hyper Backup does its own versioning, and copying
     the live folder avoids re-uploading 30 hard-linked snapshots it would
     otherwise treat as 30 separate copies.
   - `/volume1/docker/prodtrack` for `docker-compose.yml` and `.env` if the
     destination is encrypted — see step 5.
4. Schedule it **daily at 04:00**, an hour after the local job, so it always
   picks up a finished backup.
5. Tick **Enable client-side encryption** and store the recovery key in your
   password manager. Without this, `.env` and every document in `uploads` sit
   in plaintext at the destination.
6. Retention: **Smart Recycle**, which keeps hourly/daily/weekly/monthly
   versions instead of a flat count — a good match for a 30-day local window
   backed by longer-term off-box copies.

## Troubleshooting

| Log line | Cause |
|---|---|
| `container levtech-production-db-1 is not running` | The stack is down, or the compose project name changed. Check `sudo docker ps --format '{{.Names}}'`. |
| `docker not found at /usr/local/bin/docker` | Container Manager moved or was uninstalled; set `DOCKER=` in the task command. |
| `dump is only N bytes` | `pg_dump` failed — usually a wrong `DB_USER`/`DB_NAME`, or the database was mid-restart. Yesterday's backup is untouched. |
| `dump failed verification` | The dump was written but is unreadable — most often the volume filled up mid-write. Check `df -h /volume1`. |
| `only N GB free on the backup volume` | Free space, or lower `RETENTION`. |
| Nothing in the log at all | The task didn't run. Check **Task Scheduler**, and that its user is `root`. |
| `Permission denied` on a `.dump` while restoring | The `<` redirect runs as your shell user, not as `sudo`. Run `sudo -i` first — see the top of **Restoring**. |
