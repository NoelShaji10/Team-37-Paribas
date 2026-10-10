"""Train the processing-time (ETA) model on how long the REAL pipeline takes.

Tiya's python/file_time_prediction.py (PR #8 version) builds the model: per-format linear model or
gradient boosting on file format, size and concurrency, 70/15/15 split. Her own `collect` step times
her webapp parser (milliseconds), while the backend pipeline (validation, normalisation, anomaly
detection, database inserts) takes seconds. This script keeps her `train` step as it is and replaces
only the timing source:

  1. generate                 N files of varied sizes cut from the organiser CSVs
  2. feed                     drop them into backend/incoming in waves, so concurrency varies
  3. wait                     until the backend has processed every one
  4. export                   actual durations from PostgreSQL -> output/processing_timings.csv (her format)
  5. train      (her script)  best model -> output/processing_time_model.joblib (scikit-learn of this machine)
  6. reload                   the ML service picks up the new model

Run from the repo root with backend + ML service running:
    ml-service/.venv/bin/python scripts/train_eta.py --n 150
    ml-service/.venv/bin/python scripts/train_eta.py --skip-generate     # re-train on what is in the DB
"""
import argparse
import os
import random
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
HER_SCRIPT = ROOT / "python" / "file_time_prediction.py"
INCOMING = ROOT / "backend" / "incoming"
TIMINGS = ROOT / "output" / "processing_timings.csv"

EXPORT_SQL = (
    r'\copy (SELECT f."fileName" AS file_name, ' + "'CSV' AS file_format, "
    r'f."sizeBytes" AS size_bytes, f."processedRows" AS rows, '
    r'(SELECT COUNT(*) FROM "ProcessingFile" o WHERE o."startedAt" <= f."startedAt" '
    r'AND o."completedAt" >= f."startedAt") AS active_workers, '
    r'ROUND(f."actualDurationMs" / 1000.0, 3) AS duration_sec, '
    r'ROUND(EXTRACT(EPOCH FROM (f."startedAt" - f."receivedAt"))::numeric, 3) AS queue_wait_sec, '
    "'success' AS status, 'pipeline (backend)' AS data_label "
    r'FROM "ProcessingFile" f WHERE f."actualDurationMs" IS NOT NULL '
    r'AND f."processedRows" > 0 AND f.status::text IN ' + "('COMPLETED', 'NEEDS_REVIEW')) "
    "TO '{out}' WITH CSV HEADER"
)


def db_url() -> str:
    env = (ROOT / "backend" / ".env").read_text()
    m = re.search(r'^DATABASE_URL=["\']?([^"\'\n]+)', env, re.M)
    if not m:
        sys.exit("DATABASE_URL not found in backend/.env")
    url = re.sub(r"([?&])schema=[^&]*&?", r"\1", m.group(1)).rstrip("?&")  # psql rejects Prisma's schema=
    host = re.sub(r"^[a-z]+://([^@/]*@)?([^:/?]*).*", r"\2", url)
    if host not in ("localhost", "127.0.0.1", "::1", ""):
        sys.exit(f"Refusing: DATABASE_URL points to '{host}', a shared database. "
                 "Train against a local copy (scripts/copy_shared_schema.sh).")
    return url


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True, cwd=ROOT, **kw)


def generate(src: Path, n: int, min_rows: int, max_rows: int, seed: int) -> Path:
    """Cut n files (split across the 4 types) of log-uniform sizes from the organiser CSVs."""
    rng = random.Random(seed)
    out = ROOT / "output" / f"eta_files_{seed}"
    out.mkdir(parents=True, exist_ok=True)
    per_type = max(1, n // 4)
    for t in ("accounts", "bank_txns", "payments", "rates"):
        sources = sorted(src.glob(f"{t}_1,000,000.csv")) or sorted(src.glob(f"{t}_100,000.csv"))
        if not sources:
            print(f"  skip {t}: no source CSV in {src}")
            continue
        with open(sources[0], encoding="utf-8", newline="") as f:
            header, lines = f.readline(), f.readlines()
        hi, lo = min(max_rows, len(lines)), min(min_rows, len(lines))
        for i in range(per_type):
            k = int(round(lo * ((hi / lo) ** rng.random())))
            start = rng.randint(0, len(lines) - k)
            with open(out / f"{t}_eta{i:04d}_{k}_s{seed}.csv", "w", encoding="utf-8", newline="") as w:
                w.write(header)
                w.writelines(lines[start:start + k])
        print(f"  {t}: {per_type} files from {sources[0].name} ({lo:,} to {hi:,} rows)")
        del lines
    return out


def feed(folder: Path, backend: str) -> int:
    files = sorted(folder.glob("*.csv"))
    random.Random(1).shuffle(files)
    INCOMING.mkdir(parents=True, exist_ok=True)
    i = 0
    while i < len(files):
        wave = files[i:i + random.randint(1, 6)]  # 1 to 6 files at once -> different concurrency levels
        for f in wave:
            shutil.copy(f, INCOMING / f.name)
        i += len(wave)
        print(f"  fed {i}/{len(files)}")
        wait_idle(backend, quiet=True, max_wait=600)
    return len(files)


def wait_idle(backend: str, quiet: bool = False, max_wait: int = 3600) -> None:
    t0 = time.time()
    time.sleep(3)  # give the watcher time to pick files up
    while time.time() - t0 < max_wait:
        files = requests.get(f"{backend}/api/files", timeout=30).json().get("data", [])
        busy = sum(1 for f in files if f.get("status") in ("QUEUED", "PROCESSING"))
        if busy == 0:
            return
        if not quiet:
            print(f"  waiting: {busy} file(s) still processing")
        time.sleep(3)


def main():
    ap = argparse.ArgumentParser(description="Train the ETA model on real pipeline timings")
    ap.add_argument("--src", default="data", help="folder with the organiser CSVs")
    ap.add_argument("--n", type=int, default=150, help="files to generate (split across 4 types)")
    ap.add_argument("--min-rows", type=int, default=500)
    ap.add_argument("--max-rows", type=int, default=60000)
    ap.add_argument("--seed", type=int, default=int(time.time()) % 100000)
    ap.add_argument("--skip-generate", action="store_true", help="only export + train on files already processed")
    ap.add_argument("--backend", default="http://localhost:5000")
    ap.add_argument("--ml", default="http://localhost:8000")
    a = ap.parse_args()

    if not a.skip_generate:
        print("1. Generating files from the organiser CSVs")
        folder = generate(Path(a.src), a.n, a.min_rows, a.max_rows, a.seed)
        print("2. Feeding them to the pipeline through backend/incoming")
        feed(folder, a.backend)
        print("3. Waiting for the backend to finish")
        wait_idle(a.backend)

    print("4. Exporting actual durations from PostgreSQL")
    TIMINGS.parent.mkdir(parents=True, exist_ok=True)
    run(["psql", db_url(), "-v", "ON_ERROR_STOP=1", "-c", EXPORT_SQL.format(out=TIMINGS)])
    rows = sum(1 for _ in open(TIMINGS)) - 1
    print(f"  {rows} timing records in {TIMINGS}")

    print("5. Training (python/file_time_prediction.py train, PR #8 version)")
    run([sys.executable, HER_SCRIPT, "train", "--min-rows", "30"])

    print("6. Reloading the model in the ML service")
    print("  ", requests.post(f"{a.ml}/prediction/reload", timeout=30).json())


if __name__ == "__main__":
    main()
