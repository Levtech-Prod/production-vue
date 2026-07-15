#!/bin/sh
# Runs automatically once, the first time the postgres container starts
# against an empty data directory (Docker's docker-entrypoint-initdb.d
# convention). Applies the base schema, then any migrations in order.
set -e

SRC="/docker-entrypoint-initdb.d/source"

echo "Applying base schema..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$SRC/schema.sql"

if [ -d "$SRC/migrations" ]; then
  for f in "$SRC"/migrations/*.sql; do
    [ -e "$f" ] || continue
    echo "Applying migration $f"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
  done
fi
