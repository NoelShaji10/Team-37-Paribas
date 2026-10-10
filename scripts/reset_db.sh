#!/usr/bin/env bash
# Empty all processing data (files, rejections, anomalies, loaded rows) for a fresh demo run.
# Keeps the tables. Usage (from the repo root): ./scripts/reset_db.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL=$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
DB_URL=$(echo "$DB_URL" | sed -E 's/[?&]schema=[^&]*//')   # psql rejects Prisma's schema= option; keep sslmode

# Safety: never write to a shared or remote database from these scripts
DB_HOST=$(echo "$DB_URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]*).*#\2#')
case "$DB_HOST" in
  localhost|127.0.0.1|::1|"") ;;
  *) echo "Refusing: DATABASE_URL points to '$DB_HOST', a shared or remote database."
     echo "This script only works on a LOCAL database. Use ./scripts/copy_shared_schema.sh to make a local copy."
     exit 1 ;;
esac
read -r -p "This deletes all processed files, rejections and anomalies in the database. Continue? [y/N] " ok
[ "$ok" = "y" ] || { echo "Cancelled"; exit 0; }
psql "$DB_URL" -c 'TRUNCATE "Anomaly", "FaultLog", "BankTransaction", "Payment", "ExchangeRate", "Account", "ProcessingFile" CASCADE;'
rm -f "$ROOT"/backend/uploads/* 2> /dev/null || true
echo "Database emptied. Ready for a fresh run."
