#!/usr/bin/env bash
# Start the ML service, backend and frontend in the background. Logs go to logs/.
# Usage (from the repo root):  ./scripts/run_all.sh        Stop with:  ./scripts/stop_all.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"

wait_for() {  # name url logfile
  for _ in $(seq 1 90); do
    if curl -sf "$2" > /dev/null 2>&1; then echo "  OK    $1  $2"; return 0; fi
    sleep 1
  done
  echo "  FAIL  $1 did not start. Last log lines:"; tail -20 "$LOGS/$3.log"; return 1
}

echo "Checks"
pg_isready -q || { echo "  PostgreSQL is not running. Start it: brew services start postgresql@16 (or open Postgres.app)"; exit 1; }
[ -x "$ROOT/ml-service/.venv/bin/uvicorn" ] || { echo "  Missing ml-service/.venv. Run the one-time setup first."; exit 1; }
[ -f "$ROOT/backend/.env" ] || { echo "  Missing backend/.env. Copy backend/.env.example and edit it."; exit 1; }
[ -d "$ROOT/backend/node_modules" ] || { echo "  Run npm install in backend/ first."; exit 1; }
[ -d "$ROOT/frontend/node_modules" ] || { echo "  Run npm install in frontend/ first."; exit 1; }
for port in 8000 5000 5173; do
  if lsof -ti tcp:$port > /dev/null 2>&1; then echo "  Port $port is busy. Run ./scripts/stop_all.sh first."; exit 1; fi
done
echo "  OK"

echo "Starting"
(cd "$ROOT/ml-service" && .venv/bin/uvicorn app.main:app --port 8000 > "$LOGS/ml.log" 2>&1 &)
(cd "$ROOT/backend" && npm run dev > "$LOGS/backend.log" 2>&1 &)
(cd "$ROOT/frontend" && npm run dev -- --port 5173 > "$LOGS/frontend.log" 2>&1 &)

wait_for "ml-service" "http://localhost:8000/health" ml || exit 1
wait_for "backend   " "http://localhost:5000/health" backend || exit 1
wait_for "frontend  " "http://localhost:5173" frontend || exit 1

echo
echo "Running:"
echo "  Dashboard     http://localhost:5173"
echo "  Backend API   http://localhost:5000/api/files"
echo "  ML API docs   http://localhost:8000/docs"
echo "  Logs          tail -f logs/backend.log logs/ml.log"
echo "Next: ./scripts/demo.sh    Stop: ./scripts/stop_all.sh"
