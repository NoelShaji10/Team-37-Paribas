#!/usr/bin/env bash
# Copy the STRUCTURE of the shared team database (tables, enums, indexes, foreign keys) into a LOCAL
# database, so local testing matches the shared schema exactly. No data is copied.
#
# Read-only on the shared database: the only command run against it is pg_dump --schema-only.
#
# Usage (from the repo root):
#   SHARED_DATABASE_URL='postgresql://...neon.tech/neondb?sslmode=require' ./scripts/copy_shared_schema.sh [local_db_name]
set -euo pipefail
SRC="${SHARED_DATABASE_URL:?Set SHARED_DATABASE_URL to the shared (Neon) connection string}"
LOCAL_DB="${1:-team37}"
DUMP=/tmp/shared_schema.sql

# pg_dump must be at least the server's major version: use the newest one installed
PG_DUMP=""
for v in 18 17 16; do
  for d in /opt/homebrew/opt/postgresql@$v/bin /usr/local/opt/postgresql@$v/bin; do
    [ -x "$d/pg_dump" ] && [ -z "$PG_DUMP" ] && PG_DUMP="$d/pg_dump"
  done
done
[ -z "$PG_DUMP" ] && [ -x /opt/homebrew/opt/libpq/bin/pg_dump ] && PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
PG_DUMP="${PG_DUMP:-$(command -v pg_dump)}"
echo "Using $PG_DUMP ($("$PG_DUMP" --version))"

echo "1. Reading the schema from the shared database (read-only)"
if ! "$PG_DUMP" --schema-only --no-owner --no-privileges --schema=public "$SRC" > "$DUMP" 2> /tmp/pg_dump.err; then
  cat /tmp/pg_dump.err
  if grep -q "server version" /tmp/pg_dump.err; then
    echo "Your pg_dump is older than the shared server. Install a newer client: brew install postgresql@17"
  fi
  exit 1
fi
# The public schema already exists locally; drop the statements that would recreate it
sed -i.bak -E '/^CREATE SCHEMA public;/d; /^COMMENT ON SCHEMA public/d; /^ALTER SCHEMA public OWNER/d' "$DUMP"
echo "   $(grep -c '^CREATE TABLE' "$DUMP") tables, $(grep -c 'FOREIGN KEY' "$DUMP") foreign keys, $(grep -c '^CREATE TYPE' "$DUMP") enums"

read -r -p "2. DROP and recreate the LOCAL database '$LOCAL_DB' with this schema? [y/N] " ok
[ "$ok" = "y" ] || { echo "Cancelled. Schema saved in $DUMP"; exit 0; }
dropdb --if-exists "$LOCAL_DB"
createdb "$LOCAL_DB"
psql -q -v ON_ERROR_STOP=1 "$LOCAL_DB" < "$DUMP"

echo "3. Local '$LOCAL_DB' now has:"
psql -P pager=off "$LOCAL_DB" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;"
psql -P pager=off "$LOCAL_DB" -c "SELECT conrelid::regclass AS table_name, conname AS foreign_key FROM pg_constraint WHERE contype='f' ORDER BY 1;"
echo "Done. Point backend/.env at postgresql://$(whoami)@localhost:5432/$LOCAL_DB, then run: cd backend && npx prisma generate"
echo "(prisma generate only builds the client; it never changes any database)"
