# Running the whole system locally

Three services on one laptop: **ML service** (Python, port 8000), **backend** (Node, port 5000), **UI** (`frontend2`, port 5173), plus PostgreSQL.

## Pipeline, end to end

```
CSV dropped in backend/incoming/  or uploaded in the UI
 → Ingestion: checksum (duplicates rejected), type classifier
 → File-level validation (python/file_level_validation.py): name, header, encoding, record length, trailer
      failed → moved to backend/quarantine/, recorded as FAILED with the reason
 → ETA prediction (python/file_time_prediction.py model) → predictedDurationMs, shown while queued
 → Worker pool (3 files in parallel), 500-row batches:
      AI normalisation Tier A (workbook rules ACCT-1..RATE-5, logged)
      Layer 1 validation (backend validator + ISO currency / enum / PAY-8 master checks)
      rejected rows → FaultLog with AI-suggested fix, confidence and explanation
      valid rows → Layer 2 anomaly detection → Anomaly table
      account not in Accounts (TXN-2 / PAY-2) → rejected with reason, so the shared schema's foreign key never fails
      remaining rows → loaded into the target tables
 → File end: file-wide anomaly checks, ">50% rule" fix proposals (dashboard alert)
 → UI: Dashboard, File Monitoring, File Details (anomalies), Rejections, Resolution Centre (accept / edit / reject → learning)
```

## Database rule: the shared database is never modified

The shared team database (Neon) is only ever **read**, to copy its structure. All testing uses a local
copy with the identical schema. No script here runs `prisma db push` or `migrate` against it, and
`run_all.sh`, `reset_db.sh` and `train_eta.py` refuse to run when `backend/.env` points to a remote
database (set `ALLOW_SHARED_DB=1` for `run_all.sh` only if the team agrees).

## One-time setup

```bash
# Local copy of the shared schema (read-only on the shared database: pg_dump --schema-only)
SHARED_DATABASE_URL='<team connection string>' ./scripts/copy_shared_schema.sh team37
cd backend && cp .env.example .env     # DATABASE_URL=postgresql://<your-mac-user>@localhost:5432/team37
npm install && npx prisma generate && cd ..
# prisma generate only builds the client; it does not touch any database

# ML service (Python 3.12 or 3.13)
cd ml-service && python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp .env.example .env
python -m pytest -q tests && deactivate && cd ..

# UI
cd frontend2 && npm install && cd ..

# Organiser data (not committed)
mkdir -p data && cp /path/to/dataset/*.csv data/
```

## Run, demo, stop

```bash
./scripts/run_all.sh                 # starts all three, waits until each answers
./scripts/reset_db.sh                # empty processed data in the LOCAL database
cp demo/accounts_demo.csv backend/incoming/       # accounts first (transactions must reference them)
# wait until it shows Completed / Needs Review, then:
cp demo/bank_txns_demo.csv demo/payments_demo.csv backend/incoming/
./scripts/demo.sh                    # guided walkthrough in the terminal
./scripts/stop_all.sh
```
UI: http://localhost:5173 · ML API docs: http://localhost:8000/docs

## Train the ETA model on real pipeline timings (once, ~10 minutes)

```bash
ml-service/.venv/bin/python scripts/train_eta.py --n 150
```
Uses Tiya's `make-data` and `train` steps unchanged; the timings come from the backend's actual
processing (her `collect` step only times the file-level validator, which takes milliseconds).
The dashboard banner switches from "ETA: heuristic" to "ETA model: trained on N files".

## Check that everything is wired

| Check | Command | Expected |
|---|---|---|
| Anomaly models | `curl localhost:8000/anomaly/status` | each type has `fitted_at` |
| ETA model | `curl localhost:8000/prediction/status` | `method: model` after training |
| Reference data | `curl localhost:8000/normalize/reference` | 180 currencies, 170 IFSC codes |
| Suggestions saved | `psql team37 -c 'SELECT "aiSuggestion", COUNT(*) FROM "FaultLog" GROUP BY 1 ORDER BY 2 DESC LIMIT 5;'` | non-empty suggestions |
| Quarantine | drop a CSV with a wrong header into `backend/incoming/` | FAILED in the UI with "Quarantined [FILE_HEADER_MISMATCH]" |
