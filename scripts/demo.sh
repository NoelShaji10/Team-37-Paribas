#!/usr/bin/env bash
# Guided showcase: models, coverage, a concurrent burst of files, then what the database holds.
# Usage (from the repo root, with ./scripts/run_all.sh running):
#   ./scripts/demo.sh             quick burst (20,000 rows per file)
#   ./scripts/demo.sh full        full 100k files
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY="ml-service/.venv/bin/python"
DB_URL=$(grep -E '^DATABASE_URL=' backend/.env | cut -d= -f2- | tr -d '"' | tr -d "'")
DB_URL="${DB_URL%%\?*}"   # psql does not accept Prisma's ?schema= option
pause() { echo; read -r -p "Press Enter for: $1 " _; echo; }
sql() { psql "$DB_URL" -P pager=off -c "$1"; }

pause "1. Trained models loaded by the ML service"
curl -s localhost:8000/anomaly/status | "$PY" -c "
import json, sys
for t, m in json.load(sys.stdin).items():
    print(f'  {t:10s} ' + ('NOT TRAINED' if not m else
          f\"rows={m['rows']:,}  trained {m['fitted_at']}  sklearn {m.get('sklearn_trained')}  mismatch={m.get('sklearn_mismatch')}\"))"

pause "2. Coverage of the workbook's anomaly list"
curl -s localhost:8000/anomaly/coverage | "$PY" -c "
import json, sys, collections
rows = json.load(sys.stdin)
print('  Owner counts:', dict(collections.Counter(r['owner'] for r in rows)))
for r in rows:
    if r['owner'] == 'Layer 2':
        print(f\"  {r['workbook_id']:24s} {r['how'][:70]}\")"

pause "3. Month-end burst: upload all files at once and watch them process in parallel"
if [ "${1:-}" = "full" ]; then "$PY" scripts/e2e_ingest.py; else "$PY" scripts/e2e_ingest.py --rows 20000; fi

pause "4. Files and their outcome"
sql 'SELECT "originalName" AS file, "fileType", status, "processedRows" AS rows, "failedRows" AS rejected,
       ROUND("actualDurationMs"/1000.0, 1) AS seconds FROM "ProcessingFile" ORDER BY "createdAt" DESC LIMIT 8;'

pause "5. Layer 2: anomalies by type and workbook rule"
sql 'SELECT "anomalyType", details->>'"'"'ruleRef'"'"' AS rule, details->>'"'"'method'"'"' AS method, COUNT(*) AS flags
     FROM "Anomaly" GROUP BY 1, 2, 3 ORDER BY flags DESC LIMIT 15;'

pause "6. One explanation per anomaly type (what an operator sees)"
sql 'SELECT DISTINCT ON ("anomalyType") "anomalyType", ROUND(score::numeric, 2) AS score, LEFT(description, 110) AS explanation
     FROM "Anomaly" ORDER BY "anomalyType", score DESC;'

pause "7. Layer 1: top rejection reasons"
sql 'SELECT "errorType", COUNT(*) AS rows FROM "FaultLog" GROUP BY 1 ORDER BY 2 DESC LIMIT 10;'

echo "Done. Also show: http://localhost:8000/docs (try /anomaly/detect-batch live) and the evaluation tables in the notebook."
