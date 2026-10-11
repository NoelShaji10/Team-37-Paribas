#!/usr/bin/env bash
# Guided demo of shared-folder ingestion. Copies the demo files into the watched incoming/ folder
# in the right order (accounts first), pausing so you can narrate while the dashboard updates.
# Usage: ./scripts/demo_drop.sh           (main demo)
#        ./scripts/demo_drop.sh time      (time-anomaly demo)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"
DROP=$(grep -E '^FILE_DROP_ROOT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
DROP="${DROP/#\~/$HOME}"
INCOMING="${DROP:-$ROOT/backend}/incoming"
DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
DB_URL=$(echo "$DB_URL" | sed -E 's/[?&]schema=[^&]*//')

pause() { read -r -p "  [Enter] $1 " _; }
wait_accounts() {
  echo "  waiting for at least $1 accounts in the database..."
  until [ "$(psql "$DB_URL" -tAc 'SELECT COUNT(*) FROM "Account"')" -ge "$1" ]; do sleep 2; done
  echo "  accounts loaded."
}

echo "Watched folder: $INCOMING   (open it in Finder next to the dashboard)"
open "$INCOMING" 2>/dev/null || true
START=$(psql "$DB_URL" -tAc 'SELECT COUNT(*) FROM "Account"')

if [ "${1:-}" = "time" ]; then
  pause "drop the accounts file (30 accounts: savings, checking, current, business)"
  cp "$ROOT/demo/time_anomaly/accounts_timedemo.csv" "$INCOMING/"
  wait_accounts $((START + 30))
  pause "drop 200 transactions (8 night transfers from retail accounts hidden inside)"
  cp "$ROOT/demo/time_anomaly/bank_txns_timedemo.csv" "$INCOMING/"
  echo "  Open bank_txns_timedemo.csv in File Details: NIGHT_TRANSFER_RETAIL should show 8."
else
  pause "drop the accounts file (7,689 accounts)"
  cp "$ROOT/demo/accounts_demo.csv" "$INCOMING/"
  wait_accounts $((START + 7689))
  pause "drop transactions and payments together (processed in parallel)"
  cp "$ROOT/demo/bank_txns_demo.csv" "$ROOT/demo/payments_demo.csv" "$INCOMING/"
  echo "  Watch both files process in parallel on the dashboard, then open them in File Details."
fi
echo "Files move from incoming/ to processed/ (or quarantine/) when done."
